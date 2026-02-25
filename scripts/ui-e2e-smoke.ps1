$ErrorActionPreference = 'Stop'

$uiBaseUrl = if ($env:UI_BASE_URL) { $env:UI_BASE_URL } else { 'http://localhost:5173' }
$routes = @('/login', '/wallet/login', '/fi/login', '/command/login')
$failures = 0

foreach ($route in $routes) {
  $url = "$uiBaseUrl$route"
  try {
    $response = Invoke-WebRequest -Uri $url -Method Get -MaximumRedirection 5
    $statusCode = [int]$response.StatusCode
    if ($statusCode -ge 200 -and $statusCode -lt 400) {
      "{0,-28} PASS ({1})" -f $route, $statusCode
    } else {
      "{0,-28} FAIL ({1})" -f $route, $statusCode
      $failures += 1
    }
  } catch {
    $status = $_.Exception.Response.StatusCode.value__
    if ($status) {
      "{0,-28} FAIL ({1})" -f $route, $status
    } else {
      "{0,-28} FAIL (request error)" -f $route
    }
    $failures += 1
  }
}

if ($failures -gt 0) {
  throw "UI smoke check failed: $failures route(s) unreachable"
}

Write-Output 'UI smoke check passed'
