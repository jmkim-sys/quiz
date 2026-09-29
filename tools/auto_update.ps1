<#
  STORY 퀴즈 — 대시보드 자동 갱신 (2026-09-29 신설)

  무엇을 하나 (1시간마다 Windows 작업 스케줄러가 부른다)
    1) py tools/read_sheet_green.py         팀 시트의 초록 칸을 읽어 검수 완료 수를 갱신
    2) node 산출물/도구/build-dashboard.js  대시보드 HTML 다시 생성
    3) git add . / commit / push            GitHub에 반영

  ⚠️ .bat이 아니라 .ps1인 이유: 경로에 한글이 있어(`산출물\도구`) cmd.exe가 코드페이지에 따라
     깨뜨린다. PowerShell은 UTF-8(BOM) 파일을 그대로 읽는다. **이 파일의 BOM을 지우지 말 것.**

  ⚠️ 바뀐 것이 없으면 커밋하지 않는다 — 빈 커밋이 1시간마다 쌓이지 않게.
  ⚠️ `.env`는 .gitignore에 있으므로 `git add .` 로도 올라가지 않는다 (웹앱 URL·secret 보호).

  로그: tools/auto_update.log  (조용히 실패해도 여기에 남는다)

  손으로 한 번 돌려보려면:
    powershell -NoProfile -ExecutionPolicy Bypass -File tools\auto_update.ps1
#>

$ErrorActionPreference = 'Continue'

$root = Split-Path -Parent $PSScriptRoot
Set-Location $root

$log = Join-Path $PSScriptRoot 'auto_update.log'

function Write-Log([string]$msg) {
    $line = "{0}  {1}" -f (Get-Date -Format 'yyyy-MM-dd HH:mm:ss'), $msg
    Write-Output $line
    Add-Content -Path $log -Value $line -Encoding utf8
}

Write-Log '===== 자동 갱신 시작 ====='

# -- 1. 팀 시트의 초록 칸 읽기 --
# 네트워크가 끊겨 있으면 여기서 실패한다. 그때는 옛 검수완료_시트.json이 그대로 남아
# 대시보드가 «마지막으로 읽은 값»으로 만들어진다 - 숫자가 0으로 튀지 않는다.
$green = & py (Join-Path $PSScriptRoot 'read_sheet_green.py') 2>&1
$greenOk = ($LASTEXITCODE -eq 0)
$green | ForEach-Object { Add-Content -Path $log -Value "    $_" -Encoding utf8 }
if ($greenOk) {
    Write-Log '시트 읽기 성공'
} else {
    Write-Log '[주의] 시트 읽기 실패 - 마지막으로 읽은 값으로 대시보드를 만듭니다.'
}

# -- 2. 대시보드 다시 만들기 --
$build = & node (Join-Path $root '산출물\도구\build-dashboard.js') 2>&1
$buildOk = ($LASTEXITCODE -eq 0)
$build | ForEach-Object { Add-Content -Path $log -Value "    $_" -Encoding utf8 }
if (-not $buildOk) {
    Write-Log '[중단] 대시보드 생성 실패 - 커밋하지 않습니다.'
    exit 1
}
Write-Log '대시보드 생성 완료'

# -- 3. GitHub 반영 --
# ⚠️ 네이티브 exe(git·node·py)의 성패는 `$?`가 아니라 **`$LASTEXITCODE`**로 본다.
#    PowerShell 5.1은 exe의 stderr를 `2>&1`로 받으면 종료 코드가 0이어도 `$?`를 false로 만든다.
#    git push는 진행 상황을 stderr에 찍으므로, `$?`로 보면 **성공한 push를 실패로 적는다**
#    (2026-09-29에 실제로 그렇게 기록되었다 — push는 되어 있었다).
& git add .
if ($LASTEXITCODE -ne 0) { Write-Log '[중단] git add 실패'; exit 1 }

# 스테이지에 바뀐 것이 있을 때만 커밋한다. --quiet 는 차이가 없으면 종료 코드 0이다.
& git diff --cached --quiet
if ($LASTEXITCODE -eq 0) {
    Write-Log '바뀐 것이 없어 커밋하지 않았습니다.'
    Write-Log '===== 끝 ====='
    exit 0
}

$commit = & git commit -m "Update dashboard" 2>&1
$commitOk = ($LASTEXITCODE -eq 0)
$commit | ForEach-Object { Add-Content -Path $log -Value "    $_" -Encoding utf8 }
if (-not $commitOk) { Write-Log '[중단] git commit 실패'; exit 1 }
Write-Log '커밋 완료'

$push = & git push 2>&1
$pushOk = ($LASTEXITCODE -eq 0)
$push | ForEach-Object { Add-Content -Path $log -Value "    $_" -Encoding utf8 }
if ($pushOk) {
    Write-Log 'push 완료 - GitHub 반영됨'
} else {
    Write-Log '[주의] push 실패 - 커밋은 로컬에 남아 있습니다. 자격 증명 만료 여부를 확인하세요.'
    exit 1
}

Write-Log '===== 끝 ====='
