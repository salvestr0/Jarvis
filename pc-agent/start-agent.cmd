@echo off
rem Supervisor loop for the Jarvis PC agent. Launched hidden at logon by a
rem small .vbs in the user's Startup folder (see tasks/pc-access-design.md).
rem If the agent ever crashes, it restarts after 5s. Output goes to
rem pc-agent\agent.log, rotated at ~5MB so it can't grow forever.

cd /d "%~dp0.."

:loop
for %%A in ("%~dp0agent.log") do if exist %%A if %%~zA gtr 5000000 move /y "%~dp0agent.log" "%~dp0agent.log.old" > nul
echo [%date% %time%] supervisor: starting agent >> "%~dp0agent.log"
node pc-agent\agent.mjs >> "%~dp0agent.log" 2>&1
echo [%date% %time%] supervisor: agent exited, restarting in 5s >> "%~dp0agent.log"
rem ping, not timeout: timeout needs console stdin and can exit instantly in
rem this hidden context (seen 30 Jul: a crash restarted every 150ms, not 5s).
ping -n 6 127.0.0.1 > nul
goto loop
