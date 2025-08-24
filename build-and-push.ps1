# Build and Push Script for NOSTR Indexer

Write-Host "Building and pushing NOSTR Indexer to main branch..." -ForegroundColor Green

# Check git status
Write-Host "Checking git status..." -ForegroundColor Yellow
git status

# Add all changes
Write-Host "Adding changes to git..." -ForegroundColor Yellow
git add .

# Commit changes
Write-Host "Committing changes..." -ForegroundColor Yellow
git commit -m "Fix bech32 compatibility and add dotenv loading to indexer script"

# Push to main branch
Write-Host "Pushing to main branch..." -ForegroundColor Yellow
git push origin main

Write-Host "Build and push completed successfully!" -ForegroundColor Green
