' Hidden runner for the daily data export — invoked by the Windows scheduled
' task "Jarvis DB Export" (see scripts/db-export.mjs for what it does).
' Resolves the repo root from its own location, so the task definition
' survives the repo moving.
Set fso = CreateObject("Scripting.FileSystemObject")
dir = fso.GetParentFolderName(fso.GetParentFolderName(WScript.ScriptFullName))
CreateObject("WScript.Shell").Run _
  "cmd /c cd /d """ & dir & """ && npm run db:export >> backups\export.log 2>&1", 0, False
