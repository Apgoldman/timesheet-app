#!/usr/bin/env bash
# Git repository information script
# Displays current git status, branch, and remote information

# Check if git is installed
if ! command -v git >/dev/null 2>&1; then
    echo "Error: git is not installed" >&2
    exit 1
fi

# Check if current directory is a git repository
if ! git rev-parse --git-dir >/dev/null 2>&1; then
    echo "Error: not a git repository" >&2
    exit 1
fi

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

echo "=================================="