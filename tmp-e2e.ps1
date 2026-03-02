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
  $work=Join-Path (Get-Location) ("tmp-auth-"+[guid]::NewGuid().ToString('N'))
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

function JsonCall([string]$method,[string]$url,[hashtable]$headers,[object]$body){
  if($null -eq $body){ return Invoke-RestMethod -Method $method -Uri $url -Headers $headers }
  return Invoke-RestMethod -Method $method -Uri $url -Headers $headers -ContentType 'application/json' -Body ($body | ConvertTo-Json -Depth 10)
}

function Get-ErrorDetail($err){
  try {
    $status = $err.Exception.Response.StatusCode.value__
    if ($err.ErrorDetails -and $err.ErrorDetails.Message) {
      return "HTTP ${status}: $($err.ErrorDetails.Message)"
    }
    $stream = $err.Exception.Response.GetResponseStream()
    if($null -eq $stream){ return "HTTP $status" }
    $reader = New-Object System.IO.StreamReader($stream)
    $body = $reader.ReadToEnd()
    if([string]::IsNullOrWhiteSpace($body)){ return "HTTP $status" }
    return "HTTP ${status}: $body"
  } catch {
    return $err.Exception.Message
  }
}

$envMap=Load-EnvMap
$realm='bharat-kyc-dev'
$uid=$envMap['VITE_WALLET_OWNER_USER_ID']
if(-not $uid){ $uid=$envMap['KEYCLOAK_WALLET_OWNER_USER_ID'] }
if(-not $uid){ $uid='wallet-owner-1' }

$walletUser=$envMap['KEYCLOAK_WALLET_OWNER_USER']
$walletPass=$envMap['KEYCLOAK_WALLET_OWNER_PASSWORD']
$nomineeUser=$envMap['KEYCLOAK_NOMINEE_USER']
$nomineePass=$envMap['KEYCLOAK_NOMINEE_PASSWORD']

$issuerAccess=Get-ClientAccessToken $realm 'issuer-admin' $envMap['ISSUER_ADMIN_CLIENT_SECRET']
$fiSecret = $envMap['KEYCLOAK_FI_CLIENT_SECRET']
$fi2Secret = $envMap['KEYCLOAK_FI2_CLIENT_SECRET']
$fiAccess=Get-ClientAccessToken $realm $envMap['KEYCLOAK_FI_CLIENT_ID'] $fiSecret
$fi2Access=Get-ClientAccessToken $realm $envMap['KEYCLOAK_FI2_CLIENT_ID'] $fi2Secret
$walletAccess=Get-UserAccessToken $realm 'wallet-client' $walletUser $walletPass 'http://localhost:5173/wallet/login'
$nomineeAccess=Get-UserAccessToken $realm 'wallet-client' $nomineeUser $nomineePass 'http://localhost:5173/wallet/login'

$hIssuer=@{Authorization="Bearer $issuerAccess"}
$hFi=@{Authorization="Bearer $fiAccess"}
$hFi2=@{Authorization="Bearer $fi2Access"}
$hWallet=@{Authorization="Bearer $walletAccess"}
$hNominee=@{Authorization="Bearer $nomineeAccess"}

$results=New-Object System.Collections.Generic.List[object]
$s1req=$null
$s1approve=$null

function Add-Result([string]$scenario,[string]$result,[string]$detail){
  $results.Add([pscustomobject]@{Scenario=$scenario;Result=$result;Detail=$detail})
}

# S0 Issue token
try {
  $t0=JsonCall 'POST' 'http://localhost:3001/v1/issuer/kyc/issue' $hIssuer @{ kyc=@{ fullName='Enterprise User'; dob='1990-01-01'; idNumber=$uid; email='enterprise.user@example.local'; phone='+919000000001'; addressLine1='Navi Mumbai'; pincode='400706' }; ttlSeconds=1800 }
  Add-Result 'S0 Issue Token' 'PASS' $t0.tokenId
} catch {
  Add-Result 'S0 Issue Token' 'FAIL' (Get-ErrorDetail $_)
}

# S1 Owner approval + verify success
try {
  $s1req=JsonCall 'POST' 'http://localhost:3005/v1/fi/request-kyc' $hFi @{ userId=$uid; fiId='fi-client'; purpose='account-opening'; requestedFields=@('fullName','dob','idNumber'); ttlSeconds=600; requiresDelegation=$false }
  $s1approve=JsonCall 'POST' ("http://localhost:3004/v1/wallet/consents/{0}/approve" -f $s1req.consentId) $hWallet @{ reason='Approved by owner' }
  $s1verify=JsonCall 'POST' 'http://localhost:3005/v1/fi/verify-assertion' $hFi @{ consentId=$s1req.consentId; assertionJwt=$s1approve.assertionJwt }
  Add-Result 'S1 Owner Approve + Verify' ($(if($s1verify.verified){'PASS'}else{'FAIL'})) $s1req.consentId
} catch {
  Add-Result 'S1 Owner Approve + Verify' 'FAIL' (Get-ErrorDetail $_)
}

# S2 Reject path
try {
  $s2req=JsonCall 'POST' 'http://localhost:3005/v1/fi/request-kyc' $hFi @{ userId=$uid; fiId='fi-client'; purpose='loan-processing'; requestedFields=@('fullName','dob'); ttlSeconds=600; requiresDelegation=$false }
  $s2rej=JsonCall 'POST' ("http://localhost:3004/v1/wallet/consents/{0}/reject" -f $s2req.consentId) $hWallet @{ reason='User declined' }
  $rejOutcome='UNEXPECTED_SUCCESS'
  try {
    JsonCall 'POST' 'http://localhost:3005/v1/fi/verify-assertion' $hFi @{ consentId=$s2req.consentId; assertionJwt='aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa' } | Out-Null
  } catch {
    $rejOutcome="HTTP $($_.Exception.Response.StatusCode.value__)"
  }
  Add-Result 'S2 Reject + Verify Fail' ($(if($rejOutcome -ne 'UNEXPECTED_SUCCESS'){'PASS'}else{'FAIL'})) $rejOutcome
} catch {
  Add-Result 'S2 Reject + Verify Fail' 'FAIL' (Get-ErrorDetail $_)
}

# S3 Delegation required
try {
  $s3req=JsonCall 'POST' 'http://localhost:3005/v1/fi/request-kyc' $hFi @{ userId=$uid; fiId='fi-client'; purpose='insurance-claim'; requestedFields=@('fullName','dob','phone'); ttlSeconds=600; requiresDelegation=$true }
  $ownerOutcome='UNEXPECTED_SUCCESS'
  try {
    JsonCall 'POST' ("http://localhost:3004/v1/wallet/consents/{0}/approve" -f $s3req.consentId) $hWallet @{ reason='Owner attempt' } | Out-Null
  } catch {
    $ownerOutcome="HTTP $($_.Exception.Response.StatusCode.value__)"
  }
  $expiry=(Get-Date).AddDays(7).ToUniversalTime().ToString('yyyy-MM-ddTHH:mm:ssZ')
  $deleg=JsonCall 'POST' 'http://localhost:3004/v1/wallet/delegations' $hWallet @{ ownerUserId=$uid; delegateUserId=$nomineeUser; scope='consent.approve'; allowedPurposes=@('insurance-claim'); allowedFields=@('fullName','dob','phone'); expiresAt=$expiry }
  $s3approve=JsonCall 'POST' ("http://localhost:3004/v1/wallet/consents/{0}/approve" -f $s3req.consentId) $hNominee @{ reason='Nominee approval' }
  $s3verify=JsonCall 'POST' 'http://localhost:3005/v1/fi/verify-assertion' $hFi @{ consentId=$s3req.consentId; assertionJwt=$s3approve.assertionJwt }
  Add-Result 'S3 Delegation Required' ($(if($ownerOutcome -ne 'UNEXPECTED_SUCCESS' -and $s3verify.verified){'PASS'}else{'FAIL'})) ("owner=$ownerOutcome; delegation=$($deleg.id)")
} catch {
  Add-Result 'S3 Delegation Required' 'FAIL' (Get-ErrorDetail $_)
}

# S4 FI2 reuse guard
try {
  if($null -eq $s1req -or $null -eq $s1approve){
    Add-Result 'S4 FI2 Reuse Guard' 'FAIL' 'Skipped because S1 did not produce consent/assertion.'
  } else {
    $fi2Outcome='UNEXPECTED_SUCCESS'
    try {
      JsonCall 'POST' 'http://localhost:3005/v1/fi/verify-assertion' $hFi2 @{ consentId=$s1req.consentId; assertionJwt=$s1approve.assertionJwt } | Out-Null
    } catch {
      $fi2Outcome="HTTP $($_.Exception.Response.StatusCode.value__)"
    }
    Add-Result 'S4 FI2 Reuse Guard' ($(if($fi2Outcome -ne 'UNEXPECTED_SUCCESS'){'PASS'}else{'FAIL'})) $fi2Outcome
  }
} catch {
  Add-Result 'S4 FI2 Reuse Guard' 'FAIL' (Get-ErrorDetail $_)
}

# S5 Expiry
try {
  $s5req=JsonCall 'POST' 'http://localhost:3005/v1/fi/request-kyc' $hFi @{ userId=$uid; fiId='fi-client'; purpose='kyc-refresh'; requestedFields=@('fullName'); ttlSeconds=1; requiresDelegation=$false }
  Start-Sleep -Seconds 2
  $expiryOutcome='UNEXPECTED_SUCCESS'
  try {
    JsonCall 'POST' ("http://localhost:3004/v1/wallet/consents/{0}/approve" -f $s5req.consentId) $hWallet @{ reason='late approval' } | Out-Null
  } catch {
    $expiryOutcome="HTTP $($_.Exception.Response.StatusCode.value__)"
  }
  Add-Result 'S5 Consent Expiry' ($(if($expiryOutcome -ne 'UNEXPECTED_SUCCESS'){'PASS'}else{'FAIL'})) $expiryOutcome
} catch {
  Add-Result 'S5 Consent Expiry' 'FAIL' (Get-ErrorDetail $_)
}

$results | Format-Table -AutoSize
