Write-Host "[VBOS] Docker build debug mode"
Write-Host "[VBOS] This prints full Docker build output, useful when npm ci looks frozen."

docker compose build --no-cache --progress=plain vbos
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
