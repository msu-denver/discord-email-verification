#!/bin/bash
# Seed LocalStack SES with a verified email identity for local development.
# This runs automatically when the LocalStack container starts.

echo "Seeding SES email identities..."

awslocal ses verify-email-identity --email verification@msudenver.edu
awslocal ses verify-email-identity --email test@msudenver.edu

echo "Verified identities:"
awslocal ses list-identities --identity-type EmailAddress

echo "SES seeding complete!"
