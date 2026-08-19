@echo off
cd /d "%~dp0"
echo Starting reproducible AI policy-value v1 training...
python scripts\train_policy_value.py --games 250 --epochs 8 --seed 2048 --validation-games 50
pause
