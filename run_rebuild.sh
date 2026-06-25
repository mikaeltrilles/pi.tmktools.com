#!/bin/bash
cd /home/mika/Public/PIpi4
rm -f pi_checkpoint.json pi_calculate.lock
nohup python3 rebuild_checkpoint.py --digits 4673798 > pi_rebuild.log 2>&1 &
echo $! > pi_rebuild.pid
