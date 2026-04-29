# Security Model

This document describes the threat model, security controls, and defense layers for the Discord email verification bot.

## Threat model

### Assets we protect
1. **Discord bot token** — full impersonation of the bot. Worth limiting blast radius even though the bot has narrow permissions in Discord.
2. **Verification data** in DynamoDB — names of email addresses that have been verified. Low sensitivity but PII-adjacent.
3. **AWS account** — paying account for all C3 Lab cloud workloads. Misuse = real money + reputational damage.
4. **Reputation of the sender domain** (`bot.c3-lab.org`) — a hijacked sender becomes a phishing tool.

### Adversaries we defend against
1. **Drive-by spam / scanner bots** — automated mass scans for misconfig.
2. **Malicious PRs** from contributors or forks — try to exfiltrate AWS credentials by modifying CI workflows.
3. **Compromised dependencies** — npm packages with malicious updates, GitHub Actions hijacks, base image swaps.
4. **Discord-side compromise** — Discord token leaks (e.g. via GitHub).
5. **AWS account compromise** — stolen long-lived AWS keys (we don't have any, by design).
6. **Insider threat** — a maintainer goes rogue or is socially engineered.

### Adversaries we explicitly do NOT defend against
- **A nation-state APT.** Out of scope for a student-org Discord bot.
- **Physical access** to maintainer laptops with cached AWS credentials. Standard endpoint security applies.

---

## Defense layers

### Layer 1: Public repo hygiene

| Control | Implementation |
|---|---|
| `.gitignore` excludes secrets | `.env`, `*.pem`, `*.key`, `*.p12`, `*.pfx` |
| `.dockerignore` keeps build context clean | excludes `.env`, `tests/`, `.git/`, `data/`, etc. |
| Branch protection on `main` | requires PR, CODEOWNERS approval, status checks |
| CODEOWNERS gates sensitive paths | `@daniel-pittman` required on `.github/`, `infrastructure/`, `scripts/`, `Dockerfile*`, `package*.json` |
| CODEOWNERS user has direct collaborator status | not just inherited org-admin (CODEOWNERS silently ignores inherited perms) |

### Layer 2: CI workflow hardening

| Control | Implementation |
|---|---|
| Top-level `permissions: contents: read` | `GITHUB_TOKEN` defaults to read-only; jobs opt in to writes |
| Actions pinned to commit SHAs | not floating tags — protects against compromised action releases |
| `npm ci --ignore-scripts` | blocks malicious `postinstall` scripts in dependencies |
| `npm audit` warns on high-severity CVEs | warn-only initially; can tighten to fail later |
| Dependabot weekly | auto-PRs for npm + GitHub Actions updates |
| Deploy job gated `if:` | `github.ref == 'refs/heads/main' && github.event_name == 'push'` |
| GitHub production environment | deployment branches restricted to `main` only |
| No `secrets.*` in deploy workflow | uses only `vars.*` (non-sensitive ARNs) |

### Layer 3: AWS authentication (OIDC)

GitHub Actions assumes an AWS IAM role via short-lived JWT. **No long-lived AWS keys exist anywhere in the system.** The trust policy on `GhaDeployRole` requires all four conditions:

1. **Federated principal** = our specific OIDC provider
2. **`aud` claim** = `sts.amazonaws.com`
3. **`sub` claim** = `repo:msu-denver/discord-email-verification:environment:production`
4. **`ref` claim** = `refs/heads/main`

Combined with the workflow `if:` gate and the GitHub environment branch restriction, that's **six independent layers** that must all hold for AWS to issue temporary credentials. Any one failing blocks the deploy.

### Layer 4: Least-privilege IAM

#### Deploy role (`GhaDeployRole`)
What CI uses to push images and trigger deploys.

**Granted:**
- `ecr:GetAuthorizationToken` (account-wide; required by ECR)
- ECR push permissions (`PutImage`, `UploadLayerPart`, etc.) scoped to **only** the bot's repo
- `ssm:SendCommand` scoped to **only** the bot's EC2 instance ARN AND **only** the `AWS-RunShellScript` document
- `ssm:GetCommandInvocation` (account-wide; scoped by random CommandId)

**Deliberately not granted:**
- `ssm:GetParameter*` — **the deploy role cannot read the bot token** even if CI is fully compromised
- `iam:*` — cannot modify roles or policies
- Any other SSM, EC2, or DDB action

#### EC2 runtime role (`Ec2InstanceRole`)
What the bot uses at runtime.

**Granted:**
- `ssm:GetParameter*` scoped to `/discord-bot/production/*`
- `kms:Decrypt` scoped to **SSM-mediated only** via `kms:ViaService` condition
- DynamoDB R/W on **only** the verification table
- `ses:SendEmail` with `Condition: ses:FromAddress: verify@bot.c3-lab.org` — cannot send as other identities even if compromised
- ECR pull (read-only, **not push**) on **only** the bot's repo
- CloudWatch Logs write to **only** the bot's log group
- AWS-managed `AmazonSSMManagedInstanceCore` (for Session Manager)

**Deliberately not granted:**
- `iam:*` — cannot modify roles/policies
- `ssm:PutParameter` — cannot rotate its own secrets
- `ses:SendEmail` for any other From address
- ECR push of any kind

### Layer 5: Network controls

| Control | Implementation |
|---|---|
| New VPC (default deleted) | `c3-lab-vpc` with `10.0.0.0/16` |
| 4 subnets, 2 AZs | 2 public + 2 private; future-proof but only public-1a in use |
| Security group egress 443 only | no other outbound; sufficient for Discord, AWS APIs, dnf repos |
| Security group ingress: nothing | no SSH; SSM Session Manager handles shell |
| DynamoDB Gateway VPC Endpoint | DDB traffic stays inside AWS, free |

### Layer 6: Compute hardening

| Control | Implementation |
|---|---|
| IMDSv2 required | `HttpTokens: required` — defends against SSRF that exfiltrates instance role creds (the Capital One vector) |
| EBS encryption | `Encrypted: true` |
| Container runs as non-root | `USER node` in Dockerfile |
| Container `--read-only` | tmpfs for `/tmp` only |
| `npm ci --ignore-scripts` in image build | belt-and-suspenders for postinstall script defense |
| Pinned base image digest | `node:22-alpine@sha256:...` not just the tag |
| ECR `ScanOnPush: true` | every push scanned for known CVEs |

### Layer 7: Secrets management

| Control | Implementation |
|---|---|
| Bot token stored as `SecureString` in SSM | KMS-encrypted at rest |
| Discord IDs as `String` in SSM | no encryption needed (not secrets, but centralized) |
| Local `.env` file gitignored | never committed |
| `seed-ssm-parameters.sh` reads `.env` literally | uses `grep` + `sed`, not `source` — won't execute shell metacharacters |
| Container reads SSM at startup | `deploy.sh` writes `/etc/discord-bot.env` (chmod 600), `docker run --env-file` |
| Container env never printed in plaintext logs | only the deploy script's "Wrote N parameters" message |

### Layer 8: Application-level controls

| Control | Implementation |
|---|---|
| Email length cap | reject > 254 chars (RFC 5321) before storage/SES call |
| Domain whitelist | only configured domains can verify |
| Per-email verification cap | `MAX_VERIFICATIONS_PER_EMAIL = 2` |
| Per-user request throttle | 5 minutes between `/verify` calls |
| Per-code attempt cap | 3 attempts per `/verifycode` |
| Code expiration | 30 minutes |
| Admin commands gated by Discord role | `ADMIN_ROLE_ID` check on every admin subcommand |

---

## Audit checklist

Run through this before every deploy that touches infrastructure. Last run: 2026-04-29.

### Repo
- [x] `.gitignore` includes `*.env`, `*.pem`, `*.key`
- [x] `.dockerignore` excludes secrets and `.git/`
- [x] CODEOWNERS exists and lists `@daniel-pittman` (a direct collaborator) on sensitive paths
- [x] Branch protection on `main`: PR required, CODEOWNERS, status checks, no force push, no deletion
- [x] Dependabot configured for npm + github-actions

### CI
- [x] Top-level `permissions: contents: read`
- [x] All actions pinned to commit SHAs
- [x] Deploy job gated by `github.ref` + `event_name`
- [x] Deploy job uses `environment: production`
- [x] No `secrets.*` references in deploy workflow
- [x] `npm ci --ignore-scripts` in install steps

### AWS — bootstrap stack
- [x] OIDC provider for `token.actions.githubusercontent.com`
- [x] Trust policy `sub` restricted to `environment:production`
- [x] Trust policy `ref` restricted to `refs/heads/main`
- [x] Trust policy `aud` restricted to `sts.amazonaws.com`
- [x] Deploy role: ECR push only on the specific repo
- [x] Deploy role: NO `ssm:GetParameter*`
- [x] Deploy role: NO `iam:*`

### AWS — app stack
- [x] EC2 role: SSM scoped to `/discord-bot/${env}/*`
- [x] EC2 role: KMS Decrypt with `kms:ViaService` condition
- [x] EC2 role: DynamoDB scoped to specific table ARN
- [x] EC2 role: SES with `ses:FromAddress` condition
- [x] EC2 role: ECR read-only on specific repo
- [x] EC2 role: NO `iam:*`, NO `ssm:PutParameter`, NO ECR push
- [x] Security group: egress 443 only, no ingress (SSH disabled)
- [x] Instance: IMDSv2 required, EBS encrypted
- [x] DynamoDB: PointInTimeRecovery enabled
- [x] Deploy role's SSM SendCommand scoped to specific instance + document

### GitHub
- [x] Production environment exists with branch policy: `main` only
- [x] Repository variables set (no secrets needed): `AWS_DEPLOY_ROLE_ARN`, `AWS_REGION`, `ECR_REPOSITORY_URI`, `EC2_INSTANCE_ID`

### Application
- [x] Email length cap (`> 254` rejected)
- [x] Domain whitelist enforced
- [x] Rate limiting in place (per-email, per-user, per-code)
- [x] Admin commands gated by role check
- [x] No secrets in source code
- [x] `npm audit` baseline (high severity = fail; warn-only currently)

---

## Demonstrating the OIDC defense to a skeptic

**Claim:** A malicious PR cannot exfiltrate AWS credentials, even if it modifies the workflow.

**Demo:**
1. Open a PR from a fork that adds `run: aws sts get-caller-identity` somewhere in the workflow.
2. CI's `test`/`lint` jobs run (no AWS access).
3. The `deploy` job will not run because the `if:` gate blocks it (`event_name: pull_request`).
4. Even if the attacker removes the `if:` gate in their PR, the `deploy` job still fails:
   - Without `environment: production`, the OIDC `sub` claim becomes `repo:fork/repo:pull_request`, which doesn't match our trust policy (`environment:production`).
   - With `environment: production`, GitHub itself refuses to run the workflow because the production environment's branch policy blocks non-main runs.
   - Even if both of those failed, AWS would reject because the `ref` claim wouldn't be `refs/heads/main`.

Six layers must all break before AWS issues credentials.

---

## Incident response

### Suspected bot token leak
1. **Immediately rotate in Discord** — Developer Portal → Bot → Reset Token
2. Update SSM: `aws ssm put-parameter --name /discord-bot/production/DISCORD_BOT_TOKEN --type SecureString --value <new> --overwrite`
3. SSM Run Command to redeploy: `./scripts/build/deploy-to-ec2.sh` from local
4. The old token is dead the moment Discord rotates it; no AWS-side action needed

### Suspected AWS credential leak
There are no long-lived AWS credentials. If an OIDC token is somehow stolen mid-flight, it expires within ~1 hour. To revoke proactively:
1. Disable the GhaDeployRole: `aws iam attach-role-policy --role-name discord-bot-bootstrap-gha-deploy-role --policy-arn arn:aws:iam::aws:policy/AWSDenyAll`
2. Investigate via CloudTrail
3. Rotate any role policies as needed, then detach the deny

### EC2 instance compromise
1. Stop the instance: `aws ec2 stop-instances --instance-ids i-XXXX`
2. Snapshot for forensics: `aws ec2 create-snapshot --volume-id <vol> --description "Compromise IR <date>"`
3. Terminate and redeploy: `aws cloudformation update-stack` with new `ImageTag` to force fresh container
4. Review CloudWatch logs for IoCs

### Lost CODEOWNERS approval ability
If `@daniel-pittman`'s account is unavailable, an org admin can:
1. Bypass branch protection temporarily (admin-only)
2. Add another direct collaborator with maintainer/admin role
3. Update CODEOWNERS to list both
4. Re-enable branch protection

---

## References

- [AWS Well-Architected Framework — Security Pillar](https://docs.aws.amazon.com/wellarchitected/latest/security-pillar/welcome.html)
- [GitHub Docs — Security hardening with OpenID Connect](https://docs.github.com/en/actions/deployment/security-hardening-your-deployments/about-security-hardening-with-openid-connect)
- [CIS AWS Foundations Benchmark](https://www.cisecurity.org/benchmark/amazon_web_services)
- [OWASP Top 10](https://owasp.org/www-project-top-ten/)
