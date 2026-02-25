$ErrorActionPreference='Stop'

function Load-EnvMap {
  $map=@{}
  Get-Content .env | ForEach-Object {
    if ($_ -match '^\s*#' -or $_ -match '^\s*$') { return }
    $i=$_.IndexOf('=')
    if($i -gt 0){ $map[$_.Substring(0,$i).Trim()]=$_.Substring($i+1) }
  }
  return $map
}

function To-Base64Url([byte[]]$bytes){ [Convert]::ToBase64String($bytes).TrimEnd('=').Replace('+','-').Replace('/','_') }
function New-PkcePair {
  $rand=New-Object byte[] 64
  [System.Security.Cryptography.RandomNumberGenerator]::Create().GetBytes($rand)
  $verifier=To-Base64Url($rand)
  $sha=[System.Security.Cryptography.SHA256]::Create()
  $challenge=To-Base64Url($sha.ComputeHash([Text.Encoding]::ASCII.GetBytes($verifier)))
  return @{ verifier=$verifier; challenge=$challenge }
}
function Get-HeaderLocation([string]$headerFile){
  $line = Get-Content $headerFile | Where-Object { $_ -like 'Location:*' } | Select-Object -Last 1
  if(-not $line){ return $null }
  return $line.Substring('Location:'.Length).Trim()
}

function Get-UserAccessToken([string]$realm,[string]$clientId,[string]$username,[string]$password,[string]$redirectUri){
  $pkce=New-PkcePair
  $work=Join-Path (Get-Location) ('tmp-debug-'+[guid]::NewGuid().ToString('N'))
  New-Item -ItemType Directory -Path $work -Force | Out-Null

  $h1=Join-Path $work 'h1.txt'
  $h2=Join-Path $work 'h2.txt'
  $cookies=Join-Path $work 'cookies.txt'
  $body1=Join-Path $work 'body1.html'
  $body2=Join-Path $work 'body2.html'

  $authUrl='http://localhost:8080/realms/'+$realm+'/protocol/openid-connect/auth?client_id='+[uri]::EscapeDataString($clientId)+'&redirect_uri='+[uri]::EscapeDataString($redirectUri)+'&response_type=code&scope=openid&code_challenge_method=S256&code_challenge='+$pkce.challenge+'&prompt=login&login_hint='+[uri]::EscapeDataString($username)

  curl.exe -s -D $h1 -c $cookies "$authUrl" -o $body1 | Out-Null
  $loc=Get-HeaderLocation $h1

  if(-not $loc){
    $html=Get-Content $body1 -Raw
    $m=[regex]::Match($html,'id="kc-form-login"[\s\S]*?action="([^"]+)"')
    if(-not $m.Success){ throw "Keycloak login action not found for $username" }
    $action=[System.Net.WebUtility]::HtmlDecode($m.Groups[1].Value)
    if($action.StartsWith('/')){ $action='http://localhost:8080'+$action }
    $post='username='+[uri]::EscapeDataString($username)+'&password='+[uri]::EscapeDataString($password)+'&credentialId='
    curl.exe -s -D $h2 -b $cookies -c $cookies -X POST -H "Content-Type: application/x-www-form-urlencoded" --data "$post" "$action" -o $body2 | Out-Null
    $loc=Get-HeaderLocation $h2
  }

  if(-not $loc){ throw "Keycloak redirect missing for $username" }
  $codeMatch=[regex]::Match($loc,'[?&]code=([^&]+)')
  if(-not $codeMatch.Success){ throw "Authorization code missing for $username. redirect=$loc" }
  $code=[uri]::UnescapeDataString($codeMatch.Groups[1].Value)

  $tokenUrl='http://localhost:8080/realms/'+$realm+'/protocol/openid-connect/token'
  $token=Invoke-RestMethod -Method Post -Uri $tokenUrl -ContentType 'application/x-www-form-urlencoded' -Body @{ grant_type='authorization_code'; client_id=$clientId; code=$code; redirect_uri=$redirectUri; code_verifier=$pkce.verifier }

  Remove-Item -Recurse -Force $work -ErrorAction SilentlyContinue
  return $token.access_token
}

function Get-ClientAccessToken([string]$realm,[string]$clientId,[string]$secret){
  $tokenUrl='http://localhost:8080/realms/'+$realm+'/protocol/openid-connect/token'
  $token=Invoke-RestMethod -Method Post -Uri $tokenUrl -ContentType 'application/x-www-form-urlencoded' -Body @{ grant_type='client_credentials'; client_id=$clientId; client_secret=$secret }
  return $token.access_token
}

$envMap=Load-EnvMap
$realm='bharat-kyc-dev'
$uid='KYC-1234'
$walletUser=$envMap['KEYCLOAK_WALLET_OWNER_USER']
$walletPass=$envMap['KEYCLOAK_WALLET_OWNER_PASSWORD']

$fiAccess=Get-ClientAccessToken $realm $envMap['KEYCLOAK_FI_CLIENT_ID'] $envMap['KEYCLOAK_FI_CLIENT_SECRET']
$walletAccess=Get-UserAccessToken $realm 'wallet-client' $walletUser $walletPass 'http://localhost:5173/wallet/login'

function Decode-JwtPayload([string]$token){
  $payloadPart = $token.Split('.')[1]
  $payloadPart = $payloadPart.Replace('-', '+').Replace('_', '/')
  switch ($payloadPart.Length % 4) {
    2 { $payloadPart += '==' }
    3 { $payloadPart += '=' }
  }
  $json = [System.Text.Encoding]::UTF8.GetString([Convert]::FromBase64String($payloadPart))
  return $json | ConvertFrom-Json
}

$walletClaims = Decode-JwtPayload $walletAccess
"wallet preferred_username=$($walletClaims.preferred_username)"
"wallet user_id=$($walletClaims.user_id)"
"wallet sub=$($walletClaims.sub)"
"wallet scope=$($walletClaims.scope)"

$hFi=@{Authorization="Bearer $fiAccess"}
$hWallet=@{Authorization="Bearer $walletAccess"}

$req = Invoke-RestMethod -Method Post -Uri 'http://localhost:3005/v1/fi/request-kyc' -Headers $hFi -ContentType 'application/json' -Body (@{userId=$uid;fiId='fi-client';purpose='debug-check';requestedFields=@('fullName','dob');ttlSeconds=600;requiresDelegation=$false}|ConvertTo-Json)
"consentId=$($req.consentId)"

$approveBody='{"reason":"debug"}'
$walletApproveUrl = "http://localhost:3004/v1/wallet/consents/$($req.consentId)/approve"
$consentApproveUrl = "http://localhost:3003/v1/consent/$($req.consentId)/approve"

'--- wallet-service approve via curl ---'
curl.exe -i -s -X POST `
  -H "Authorization: Bearer $walletAccess" `
  -H "Content-Type: application/json" `
  --data "$approveBody" `
  $walletApproveUrl

'--- consent-manager approve via curl ---'
curl.exe -i -s -X POST `
  -H "Authorization: Bearer $walletAccess" `
  -H "Content-Type: application/json" `
  --data "$approveBody" `
  $consentApproveUrl
