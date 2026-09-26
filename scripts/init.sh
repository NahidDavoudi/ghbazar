#!/bin/bash
cd ..
rm -rf .git
git init
echo '.env' >> .gitignore
git add .
git commit -m "first init"
git branch dev
git checkout dev
echo "✓ Repository initialized"
echo "✓ Branch: dev"
