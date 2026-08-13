$ErrorActionPreference = 'Stop'
$ts = Get-Date -Format 'HHmmss'
$username = "e2e$ts"
$body = @{
    username = $username
    password = 'test123456'
} | ConvertTo-Json -Compress
Write-Host "Registering $username ..."
$reg = Invoke-RestMethod -Uri 'https://vjbugpoxinddrwfkkfkn.supabase.co/functions/v1/game-api/auth/register' -Method POST -ContentType 'application/json' -Body ([System.Text.Encoding]::UTF8.GetBytes($body))
$token = $reg.token
Write-Host "TOKEN=$token"
Write-Host 'Saving game ...'
$save = @{
    board = @(@(2,4,2,4),@(4,2,4,2),@(2,4,2,4),@(4,2,4,2))
    score = 128
    steps = 50
    elapsedMs = 60000
    timerMode = 'up'
} | ConvertTo-Json -Compress
Invoke-RestMethod -Uri 'https://vjbugpoxinddrwfkkfkn.supabase.co/functions/v1/game-api/saves/4' -Method PUT -ContentType 'application/json' -Body ([System.Text.Encoding]::UTF8.GetBytes($save)) -Headers @{Authorization="Bearer $token"} | ConvertTo-Json
Write-Host 'Loading game ..'
Invoke-RestMethod -Uri 'https://vjbugpoxinddrwfkkfkn.supabase.co/functions/v1/game-api/saves/4' -Method GET -Headers @{Authorization="Bearer $token"} | ConvertTo-Json
Write-Host 'Submitting record ..'
$record = @{
    board = @(@(2,4,2,4),@(4,2,4,2),@(2,4,2,4),@(4,2,4,2))
    score = 256
    steps = 80
    durationMs = 90000
} | ConvertTo-Json -Compress
Invoke-RestMethod -Uri 'https://vjbugpoxinddrwfkkfkn.supabase.co/functions/v1/game-api/records/4' -Method POST -ContentType 'application/json' -Body ([System.Text.Encoding]::UTF8.GetBytes($record)) -Headers @{Authorization="Bearer $token"} | ConvertTo-Json
Write-Host 'Fetching personal records ..'
Invoke-RestMethod -Uri 'https://vjbugpoxinddrwfkkfkn.supabase.co/functions/v1/game-api/records/me/4' -Method GET -Headers @{Authorization="Bearer $token"} | ConvertTo-Json
Write-Host 'Fetching leaderboard ..'
Invoke-RestMethod -Uri 'https://vjbugpoxinddrwfkkfkn.supabase.co/functions/v1/game-api/leaderboard/4' -Method GET | ConvertTo-Json
