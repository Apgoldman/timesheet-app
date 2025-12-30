#!/usr/bin/env bash
# Git repository information script
# Displays current git status, branch, and remote information

echo "=== Git Repository Information ==="
echo ""

echo "Current Branch:"
git branch --show-current
echo ""

echo "Repository Status:"
git status
echo ""

echo "Remote Repositories:"
git remote -v
echo ""

echo "==================================="
