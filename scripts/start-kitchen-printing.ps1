param(
  [Parameter(Mandatory = $true)]
  [string]$Url
)

$parsedUrl = $null
if (-not [Uri]::TryCreate($Url, [UriKind]::Absolute, [ref]$parsedUrl) -or $parsedUrl.Scheme -notin @("http", "https")) {
  throw "Informe o endereco HTTPS do Servia, por exemplo: https://servia.vercel.app"
}

$candidates = @(
  (Join-Path ${env:ProgramFiles(x86)} "Microsoft\Edge\Application\msedge.exe"),
  (Join-Path $env:ProgramFiles "Microsoft\Edge\Application\msedge.exe"),
  (Join-Path ${env:ProgramFiles(x86)} "Google\Chrome\Application\chrome.exe"),
  (Join-Path $env:ProgramFiles "Google\Chrome\Application\chrome.exe"),
  (Join-Path $env:LOCALAPPDATA "Microsoft\Edge\Application\msedge.exe"),
  (Join-Path $env:LOCALAPPDATA "Google\Chrome\Application\chrome.exe")
)
$browser = $candidates | Where-Object { Test-Path -LiteralPath $_ } | Select-Object -First 1

if (-not $browser) {
  throw "Instale o Google Chrome ou o Microsoft Edge neste computador antes de iniciar a impressao automatica."
}

$profilePath = Join-Path $env:LOCALAPPDATA "ServiaKitchenProfile"
$kitchenUrl = [Uri]::new($parsedUrl.GetLeftPart([UriPartial]::Authority) + "/cozinha")
$browserArguments = @(
  "--kiosk",
  "--kiosk-printing",
  "--no-first-run",
  "--no-default-browser-check",
  "--user-data-dir=$profilePath",
  "--app=$($kitchenUrl.AbsoluteUri)"
)

Start-Process -FilePath $browser -ArgumentList $browserArguments
