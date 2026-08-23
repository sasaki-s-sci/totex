<#
.SYNOPSIS
    Installs a released totex on Windows.

.DESCRIPTION
    One script, any released version. Nothing about a version is built into
    this file: which one to install is decided by the `latest.json` it reads,
    so the copy of this script downloaded today still installs the version
    asked for a year from now, and there is one installer to point people at
    rather than one per release.

    What it fetches is exactly what the app fetches to update itself -- the
    same manifest, the same installer, checked against the same key -- because
    there is no reason for a machine to have two ways in and only one of them
    checked. An install is the first update, and this is what does it before
    there is an app to do it.

    What it does not do is decide anything the installer itself asks. Left
    alone it hands over to the two pages the installer has always shown --
    where the app goes, and whether there is a desktop shortcut -- and the
    switches below are for the times somebody wants those answered from here
    instead.

.PARAMETER Version
    A released version, with or without the leading v. The newest release if
    this is left out. A version asked for here is what stays installed: the
    app's own update button is what moves it on from there.

.PARAMETER Dir
    Where the app goes. Left out, the installer offers its usual folder under
    %LOCALAPPDATA% -- or wherever an earlier install of it went.

.PARAMETER Silent
    Install without showing anything at all. The answers are the ones the
    pages would have defaulted to.

.PARAMETER NoShortcut
    Leave the desktop shortcut out, which only the .exe installer can be told.
    Worth knowing: a silent install makes one unless this is given, because
    that is what its page would have done.

.PARAMETER Run
    Open totex once it is installed. An installer left to show its pages does
    that anyway, so this is for the installs that show nothing -- and for the
    .msi, which never opens anything unless it is asked to.

.PARAMETER Msi
    Take the .msi rather than the .exe. The .msi installs for every account on
    the machine and asks for administrator to do it; the .exe installs for the
    one running it and asks for nothing.

.EXAMPLE
    .\install.ps1

.EXAMPLE
    .\install.ps1 -Version 0.1.2 -Silent
#>

param(
    [string] $Version,
    [string] $Dir,
    [switch] $Silent,
    [switch] $NoShortcut,
    [switch] $Run,
    [switch] $Msi,
    [switch] $Help
)

$ErrorActionPreference = 'Stop'
# Invoke-WebRequest draws a progress bar that costs more than the download on
# Windows PowerShell, and this has its own lines to say what is happening.
$ProgressPreference = 'SilentlyContinue'

$Repo = 'sasaki-s-sci/totex'

# The key every release is signed with, verbatim from `plugins > updater >
# pubkey` in src-tauri/tauri.conf.json -- the build refuses to run if the two
# ever stop being the same string. It is the app's own key on purpose: a
# download this script accepts is one the installed app would also accept.
$PublicKey = 'dW50cnVzdGVkIGNvbW1lbnQ6IG1pbmlzaWduIHB1YmxpYyBrZXk6IEE1Mzg0NDdDQzMyRjc5RjIKUldUeWVTL0RmRVE0cFNIcTBWL3FCbDV3MzZRVm95ZjZUdWZWazdVWEJVNGppRGdoNkNLanE1eDgK'

function Write-Step([string] $Message) { Write-Host $Message }

# Runs one of the two verifiers and answers with what it exited with. Anything
# either of them prints is thrown away, stderr included: being told no is half
# of what a verifier is asked, and PowerShell otherwise treats a tool that
# explains itself on stderr as a failure of the script rather than an answer.
function Invoke-Tool([string] $Path, [string[]] $Arguments) {
    $previous = $ErrorActionPreference
    $ErrorActionPreference = 'Continue'
    try {
        & $Path @Arguments 2>&1 | Out-Null
        return $LASTEXITCODE
    } finally {
        $ErrorActionPreference = $previous
    }
}

function Stop-Install([string] $Message) {
    Write-Host $Message -ForegroundColor Red
    exit 1
}

function Show-Usage {
    @'
Usage: install.ps1 [-Version X.Y.Z] [-Dir PATH] [-Silent] [-NoShortcut] [-Run] [-Msi]

  -Version      A released version, with or without the leading v. The newest
                release if this is left out.
  -Dir          Where the app goes. The installer's usual folder if left out.
  -Silent       Install without showing anything.
  -NoShortcut   Leave the desktop shortcut out (the .exe installer only).
  -Run          Open totex once it is installed, which an installer showing
                its pages does anyway.
  -Msi          Take the .msi -- every account, and administrator to do it --
                rather than the .exe, which installs for this account alone.
'@
}

# The manifest to read. Every release carries one under a fixed name, which is
# what makes both of these a single unchanging URL: the newest release always
# answers the first, and a release that has already happened always answers the
# second with what it shipped, whatever has been released since.
function Get-ManifestUrl {
    if ($Version) {
        return "https://github.com/$Repo/releases/download/v$Version/latest.json"
    }
    return "https://github.com/$Repo/releases/latest/download/latest.json"
}

# --- verifying ---------------------------------------------------------------
#
# The manifest carries, beside every download, the signature the app checks
# before it replaces itself with it. This checks the same signature before it
# puts anything on the machine, so that a release page that has been tampered
# with is turned down here exactly as it would be turned down there.
#
# Neither of the two ways of checking it is written out below. minisign does it
# in one command; an openssl new enough to know both halves does it in four,
# because a tauri signature is minisign's prehashed kind -- a raw Ed25519
# signature over the BLAKE2b-512 of the file. What is deliberately not here is
# the arithmetic itself: hand-written crypto in the one thing standing between
# a download and the machine would be worse than the tampering it is meant to
# catch.

function Find-Verifier([string] $Work) {
    $minisign = Get-Command minisign -ErrorAction SilentlyContinue
    if ($minisign) { return @{ Kind = 'minisign'; Path = $minisign.Source } }

    # Nothing on Windows carries an openssl, but Git for Windows does, and
    # anybody with a use for totex has Git. Its own folder is found through
    # git itself rather than guessed at, since it can be installed anywhere.
    $candidates = New-Object System.Collections.Generic.List[string]
    $onPath = Get-Command openssl -ErrorAction SilentlyContinue
    if ($onPath) { $candidates.Add($onPath.Source) }
    $git = Get-Command git -ErrorAction SilentlyContinue
    if ($git) {
        $root = Split-Path (Split-Path $git.Source)
        $candidates.Add((Join-Path $root 'usr\bin\openssl.exe'))
        $candidates.Add((Join-Path $root 'mingw64\bin\openssl.exe'))
    }
    foreach ($base in @($env:ProgramFiles, ${env:ProgramFiles(x86)}, "$env:LOCALAPPDATA\Programs")) {
        if ($base) { $candidates.Add((Join-Path $base 'Git\usr\bin\openssl.exe')) }
    }

    foreach ($candidate in $candidates) {
        if (-not (Test-Path -LiteralPath $candidate)) { continue }
        # Older builds have no BLAKE2b, and one that cannot hash cannot check.
        $probe = Join-Path $Work 'blake2b.probe'
        $knows = (Invoke-Tool $candidate @('dgst', '-blake2b512', '-binary', '-out', $probe, $candidate)) -eq 0
        Remove-Item -LiteralPath $probe -ErrorAction SilentlyContinue
        if ($knows) { return @{ Kind = 'openssl'; Path = $candidate } }
    }

    Stop-Install @'
totex releases are signed and nothing here can check the signature.
Install minisign and run this again:

    winget install -e --id jedisct1.minisign
'@
}

function Test-Signature($Verifier, [string] $Bundle, [string] $Signature, [string] $Work) {
    Write-Step 'Checking the signature'

    # A tauri signature travels as base64 of the whole minisign document: a
    # comment, the signature, a trusted comment, and a signature over that.
    $document = [Text.Encoding]::UTF8.GetString([Convert]::FromBase64String($Signature))
    $lines = $document -split "`r?`n"
    if ($lines.Count -lt 4) { Stop-Install 'The release manifest holds a signature that is not one' }

    if ($Verifier.Kind -eq 'minisign') {
        $sigPath = Join-Path $Work 'bundle.sig'
        [IO.File]::WriteAllText($sigPath, $document)
        $key = ([Text.Encoding]::UTF8.GetString([Convert]::FromBase64String($PublicKey)) -split "`r?`n")[1]
        if ((Invoke-Tool $Verifier.Path @('-V', '-q', '-m', $Bundle, '-x', $sigPath, '-P', $key)) -ne 0) {
            Stop-Install 'The download is not signed by the key totex is released with'
        }
        return
    }

    # A minisign signature is two bytes of algorithm, eight of key id and then
    # the 64 the signing actually produced; a public key is the same shape with
    # 32 at the end. openssl wants the key wrapped in the twelve bytes of DER
    # that say what it is.
    $signed = [Convert]::FromBase64String($lines[1])
    if ($signed.Length -lt 74 -or $signed[0] -ne 0x45 -or $signed[1] -ne 0x44) {
        Stop-Install 'The signature is not of the kind totex is released with'
    }
    $raw = $signed[($signed.Length - 64)..($signed.Length - 1)]
    $rawPath = Join-Path $Work 'signature.raw'
    [IO.File]::WriteAllBytes($rawPath, $raw)

    $keyLine = ([Text.Encoding]::UTF8.GetString([Convert]::FromBase64String($PublicKey)) -split "`r?`n")[1]
    $keyBytes = [Convert]::FromBase64String($keyLine)
    $der = @(0x30, 0x2a, 0x30, 0x05, 0x06, 0x03, 0x2b, 0x65, 0x70, 0x03, 0x21, 0x00) +
        $keyBytes[($keyBytes.Length - 32)..($keyBytes.Length - 1)]
    $derPath = Join-Path $Work 'public.der'
    [IO.File]::WriteAllBytes($derPath, [byte[]] $der)

    $digestPath = Join-Path $Work 'digest'
    if ((Invoke-Tool $Verifier.Path @('dgst', '-blake2b512', '-binary', '-out', $digestPath, $Bundle)) -ne 0) {
        Stop-Install 'The download could not be hashed to check it'
    }

    # The verifier is asked to say no before it is trusted to say yes: an
    # openssl that accepts a digest with a byte on the end of it is one whose
    # acceptance of the real digest would mean nothing at all.
    $wrongPath = Join-Path $Work 'digest.wrong'
    [IO.File]::WriteAllBytes($wrongPath, [IO.File]::ReadAllBytes($digestPath) + [byte] 0x21)
    if (Test-OpensslAccepts $Verifier $derPath $wrongPath $rawPath) {
        Stop-Install 'The signature check is not working -- it accepted a file it should have refused'
    }

    if (-not (Test-OpensslAccepts $Verifier $derPath $digestPath $rawPath)) {
        Stop-Install 'The download is not signed by the key totex is released with'
    }

    # minisign signs its trusted comment as well, and checking one signature
    # and not the other would leave "verified" meaning something narrower here
    # than it means everywhere else the word is used about this key.
    $comment = [Text.Encoding]::UTF8.GetBytes(($lines[2] -replace '^trusted comment: ', ''))
    $globalMessage = Join-Path $Work 'global.message'
    [IO.File]::WriteAllBytes($globalMessage, $raw + $comment)
    $globalRaw = Join-Path $Work 'global.raw'
    [IO.File]::WriteAllBytes($globalRaw, [Convert]::FromBase64String($lines[3]))
    if (-not (Test-OpensslAccepts $Verifier $derPath $globalMessage $globalRaw)) {
        Stop-Install "The signature's own comment is not signed by the key totex is released with"
    }
}

function Test-OpensslAccepts($Verifier, [string] $Der, [string] $Message, [string] $Signature) {
    return (Invoke-Tool $Verifier.Path @(
            'pkeyutl', '-verify', '-pubin', '-inkey', $Der, '-keyform', 'DER',
            '-rawin', '-in', $Message, '-sigfile', $Signature)) -eq 0
}

# --- handing over to the installer -------------------------------------------

# What the installer is told. Nothing is passed that was not asked for: with no
# switches this is empty, and the installer shows the pages it has always
# shown. /D is last and unquoted because that is the only way NSIS reads it,
# which is also why the whole line is built as one string.
function Get-NsisArguments {
    $arguments = @()
    if ($Silent) { $arguments += '/S' }
    if ($NoShortcut) { $arguments += '/NS' }
    # A silent install starts nothing unless it is told to, which is what /R
    # tells it. An install showing its pages opens the app either way.
    if ($Run) { $arguments += '/R' }
    if ($Dir) { $arguments += "/D=$Dir" }
    return ($arguments -join ' ')
}

# The same for the .msi, which answers to properties rather than to switches.
# There is no -NoShortcut here: the .msi keeps its desktop shortcut in the same
# feature as its Start menu one, so leaving the first out would take the second
# with it, and quietly installing something other than what was asked for is
# worse than saying no.
function Get-MsiArguments([string] $Package) {
    $arguments = @('/i', "`"$Package`"")
    if ($Silent) { $arguments += '/qn' }
    if ($Run) { $arguments += 'AUTOLAUNCHAPP=1' }
    if ($Dir) { $arguments += "INSTALLDIR=`"$Dir`"" }
    return $arguments
}

# --- doing it ----------------------------------------------------------------

if ($Help) { Show-Usage; exit 0 }

if ($Msi -and $NoShortcut) {
    Stop-Install '-NoShortcut is only something the .exe installer can be told'
}

if ($Version) {
    $Version = $Version -replace '^v', ''
    if ($Version -notmatch '^\d+\.\d+\.\d+$') { Stop-Install "$Version is not a version" }
}

# Windows PowerShell talks TLS 1.0 unless told otherwise, and github.com has
# not answered that in years.
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12

$work = Join-Path $env:TEMP ("totex-install-" + [Guid]::NewGuid().ToString('n').Substring(0, 8))
New-Item -ItemType Directory -Path $work | Out-Null
try {
    $verifier = Find-Verifier $work

    $manifestUrl = Get-ManifestUrl
    try {
        $manifest = (Invoke-WebRequest -Uri $manifestUrl -UseBasicParsing).Content | ConvertFrom-Json
    } catch {
        $which = if ($Version) { " at v$Version" } else { '' }
        Stop-Install "There is no release to install$which"
    }

    if ($Version -and $manifest.version -ne $Version) {
        Stop-Install "v$Version was asked for and the release under that tag says $($manifest.version)"
    }
    $released = $manifest.version

    $target = if ($Msi) { 'windows-x86_64-msi' } else { 'windows-x86_64-nsis' }
    $entry = $manifest.platforms.$target
    if (-not $entry) { Stop-Install "totex $released has nothing for $target" }

    $bundle = Join-Path $work ([IO.Path]::GetFileName(([Uri] $entry.url).LocalPath))
    Write-Step "Downloading totex $released"
    try {
        Invoke-WebRequest -Uri $entry.url -OutFile $bundle -UseBasicParsing
    } catch {
        Stop-Install "$($entry.url) could not be downloaded"
    }

    Test-Signature $verifier $bundle $entry.signature $work

    Write-Step 'Installing'
    if ($Msi) {
        $process = Start-Process -FilePath 'msiexec.exe' -ArgumentList (Get-MsiArguments $bundle) -Wait -PassThru
    } else {
        $arguments = Get-NsisArguments
        if ($arguments) {
            $process = Start-Process -FilePath $bundle -ArgumentList $arguments -Wait -PassThru
        } else {
            $process = Start-Process -FilePath $bundle -Wait -PassThru
        }
    }

    # 1602 is the msi's way of saying somebody closed it, and NSIS says the
    # same with 1. Neither is a failure worth a red line.
    switch ($process.ExitCode) {
        0 { Write-Step "totex $released is installed" }
        1 { Write-Step 'The installer was closed before it finished' }
        1602 { Write-Step 'The installer was closed before it finished' }
        default { Stop-Install "The installer stopped with $($process.ExitCode)" }
    }
} finally {
    Remove-Item -LiteralPath $work -Recurse -Force -ErrorAction SilentlyContinue
}
