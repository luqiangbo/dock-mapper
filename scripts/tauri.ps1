$ErrorActionPreference = "Stop"

$libclangCandidates = @(
  (Join-Path ([Environment]::GetFolderPath("UserProfile")) "Documents\LLVM\bin\libclang.dll"),
  "C:\Program Files\LLVM\bin\libclang.dll"
)

$libclang = $libclangCandidates |
  Where-Object { Test-Path -LiteralPath $_ } |
  Select-Object -First 1

if (-not $libclang) {
  throw "LLVM libclang.dll was not found. Install LLVM or set LIBCLANG_PATH for this terminal."
}

# Use LLVM only for this Tauri/Cargo child process; do not alter system PATH or profiles.
$env:LIBCLANG_PATH = Split-Path -Parent $libclang

& pnpm exec tauri @args
exit $LASTEXITCODE
