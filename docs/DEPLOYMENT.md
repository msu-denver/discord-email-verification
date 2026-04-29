# Deployment Runbook

Operational procedures for the Discord email verification bot.

For the security model behind these procedures, see [SECURITY.md](./SECURITY.md).

## Prerequisites for the commands in this doc

Most commands in this doc assume two environment variables are set:

```bash
export AWS_PROFILE=<your-aws-profile-name>
export AWS_REGION=us-east-1
```

`AWS_PROFILE` should match a profile in your `~/.aws/credentials` (or `~/.aws/config`) that has admin or sufficiently broad access to the AWS account hosting the bot. If you use the AWS CLI's default profile or environment-based credentials, you can omit `AWS_PROFILE`.

If you prefer, you can pass `--profile <name>` explicitly to each `aws` command instead of using the env var.

## Architecture at a glance

```
GitHub main merge                            AWS us-east-1
-----------------                            -------------
PR merged to main                            Route 53: c3-lab.org
       |                                       apex -> GitHub Pages
       | OIDC (1hr tokens)                     bot.c3-lab.org -> SES sender
       v                                                |
[GitHub Actions deploy job]                  [Bootstrap stack]
  1. assume GhaDeployRole         ------>      OIDC provider
  2. docker build + push to ECR   ------>      GhaDeployRole
  3. ssm send-command to EC2      ------>      ECR repo
                                                        |
                                                        v
                                             [App stack]
                                               DynamoDB, EC2, IAM,
                                               security group, log group
                                                        |
                                                        v
                                             [EC2: Docker container]
                                               reads SSM at start,
                                               sends mail via SES,
                                               talks to Discord
```

---

## Routine: deploying a code change

The expected daily-ops flow.

1. Open a PR with the change. Include the standard `Co-Authored-By` line if I (Claude) made the changes.
2. Tests must pass and a code owner must approve.
3. Merge the PR (squash merge, by convention).
4. CI automatically:
   - Builds `Dockerfile.ecs`
   - Pushes to ECR with tags `main-<short-sha>` + `latest`
   - Sends SSM Run Command to the EC2 instance
   - On-instance `deploy.sh` pulls the new image and restarts the container
5. Verify in CloudWatch logs that the bot reconnected.

That's it. No manual steps.

---

## Routine: updating SSM parameters (e.g., new sender email)

```bash
# 1. Update the value locally in .env (or just remember it)
# 2. From the repo root:
./scripts/aws/seed-ssm-parameters.sh production --overwrite

# 3. Trigger a redeploy so the running container picks up the new env
aws ssm send-command \
  --instance-ids "$(aws cloudformation describe-stacks --stack-name discord-bot-production --query 'Stacks[0].Outputs[?OutputKey==`Ec2InstanceId`].OutputValue' --output text --region "$AWS_REGION")" \
  --document-name AWS-RunShellScript \
  --parameters 'commands=["set -a && . /etc/discord-bot.envrc && set +a && /usr/local/bin/deploy.sh latest 2>&1"]' \
  --region "$AWS_REGION"
```

If the change affects something the IAM policy enforces (e.g., `SES_FROM_EMAIL`), you also need to update the CloudFormation stack so the policy condition matches:

```bash
aws cloudformation deploy \
  --stack-name discord-bot-production \
  --template-file infrastructure/app.yaml \
  --capabilities CAPABILITY_NAMED_IAM \
  --parameter-overrides SesFromEmail=<new-value> \
  --region "$AWS_REGION"
```

---

## Routine: rolling back

Two rollback paths depending on how broken things are.

### Soft rollback: redeploy a previous image tag

If the new image is bad but the EC2 host is fine:

```bash
# Find a previous tag in ECR
aws ecr describe-images \
  --repository-name c3-lab/discord-email-verification \
  --query 'sort_by(imageDetails,&imagePushedAt)[-5:].[imageTags,imagePushedAt]' \
  --output table \
  --region "$AWS_REGION"

# Pick a known-good main-<sha> tag and redeploy
PREVIOUS_TAG=main-abc1234
INSTANCE_ID=$(aws cloudformation describe-stacks \
  --stack-name discord-bot-production \
  --query 'Stacks[0].Outputs[?OutputKey==`Ec2InstanceId`].OutputValue' \
  --output text --region "$AWS_REGION")
aws ssm send-command \
  --instance-ids "$INSTANCE_ID" \
  --document-name AWS-RunShellScript \
  --parameters "commands=['set -a && . /etc/discord-bot.envrc && set +a && /usr/local/bin/deploy.sh $PREVIOUS_TAG 2>&1']" \
  --region "$AWS_REGION"
```

The previous image stays in ECR for at least 10 main-tagged versions thanks to the lifecycle policy.

### Hard rollback: revert the merge commit

If the change introduces a real bug we want out of `main`:

1. `git revert -m 1 <merge-commit-sha>` on a new branch
2. Open a PR, get review, merge
3. CI rolls forward to the reverted state

The "soft" path is faster (no new build) but leaves the bad code in `main`.

---

## Routine: shell access on the EC2 instance

**Use SSM Session Manager. There is no SSH.**

```bash
INSTANCE_ID=$(aws cloudformation describe-stacks \
  --stack-name discord-bot-production \
  --query 'Stacks[0].Outputs[?OutputKey==`Ec2InstanceId`].OutputValue' \
  --output text --region "$AWS_REGION")

aws ssm start-session --target $INSTANCE_ID --region "$AWS_REGION"
```

This drops you into a shell on the instance as `ssm-user` (sudo available). Session is logged to CloudWatch Logs by AWS for audit.

If SSM agent is broken (extreme situation), you can temporarily allow SSH by setting the `SshIngressCidr` parameter in the app stack and using `~/.ssh/discord-bot-keypair.pem`. Set the CIDR to your `/32` only and remove it afterwards.

---

## Routine: viewing logs

```bash
# Tail container logs
aws logs tail /aws/ec2/discord-bot-production --follow --region "$AWS_REGION"

# Last hour of bot activity
aws logs tail /aws/ec2/discord-bot-production --since 1h --region "$AWS_REGION"

# UserData / cloud-init log (only on first boot)
# SSM into the instance, then:
sudo cat /var/log/user-data.log
```

The container's stdout/stderr go to CloudWatch via the `awslogs` Docker driver. Discord events, SES sends, DynamoDB ops all show up here.

---

## First-time deployment from scratch

If the AWS account is empty (e.g., setting up a fresh staging environment), here's the order of operations.

### 1. Manual prerequisites (~30 min)
- Delete the default VPC, create a new VPC with public + private subnets, IGW, route tables, DynamoDB Gateway Endpoint.
- Create an EC2 key pair and save the `.pem` to `~/.ssh/`.
- Verify a sender identity in SES (we use `bot.c3-lab.org` as a domain identity).

### 2. Seed SSM (~5 min)
- Populate the local `.env` with all required bot config.
- Run `./scripts/aws/seed-ssm-parameters.sh production`.

### 3. Deploy bootstrap stack (~10 min)
```bash
aws cloudformation deploy \
  --stack-name discord-bot-bootstrap \
  --template-file infrastructure/bootstrap.yaml \
  --capabilities CAPABILITY_NAMED_IAM \
  --region "$AWS_REGION"
```
Capture stack outputs and add to GitHub repository variables: `AWS_DEPLOY_ROLE_ARN`, `AWS_REGION`, `ECR_REPOSITORY_URI`.

### 4. Configure GitHub repo (~5 min)
- Create the production environment with deployment branches restricted to `main` only.
- Set up branch protection on `main`: PR required, CODEOWNERS, status checks.

### 5. First image push via CI (~5 min)
- Open and merge a tiny PR (e.g., updating a comment).
- CI builds and pushes the first image to ECR.

### 6. Deploy app stack (~10 min)
```bash
aws cloudformation deploy \
  --stack-name discord-bot-production \
  --template-file infrastructure/app.yaml \
  --capabilities CAPABILITY_NAMED_IAM \
  --parameter-overrides \
    VpcId=vpc-XXXX SubnetId=subnet-XXXX \
    KeyPairName=discord-bot-keypair \
    SesFromEmail=verify@bot.c3-lab.org \
  --region "$AWS_REGION"
```
Capture the EC2 instance ID and add to GitHub repo variables as `EC2_INSTANCE_ID`.

### 7. Verify
- Bot shows online in Discord.
- CloudWatch log group receives logs.
- Run `/admin domain-add` and a `/verify` flow end to end.

---

## Updating CloudFormation templates

Stack updates can be deployed manually:

```bash
aws cloudformation deploy \
  --stack-name discord-bot-production \
  --template-file infrastructure/app.yaml \
  --capabilities CAPABILITY_NAMED_IAM \
  --parameter-overrides ... \
  --region "$AWS_REGION"
```

For changes that would replace resources (rare for us), CloudFormation creates new ones first and deletes old ones, so the bot stays up.

For changes that update in place (most common — IAM policy edits, security group rule changes), the bot's container keeps running unmodified. We trigger a redeploy separately if the container itself needs to pick up the change.

**There is no CI automation for stack updates.** This is intentional — infrastructure changes deserve human review of the diff before applying. Future improvement: add a CI job that runs `aws cloudformation deploy --no-execute-changeset` on PR open to surface the changeset for review.

---

## Cost monitoring

| Resource | Approximate monthly cost |
|---|---|
| EC2 `t3.micro` | $7-8 (free tier first year) |
| EBS 20 GB gp3 | $1.60 |
| Route 53 hosted zone | $0.50 |
| `c3-lab.org` registration | $1.25 amortized ($15/yr) |
| DynamoDB on-demand | <$0.01 at our volume |
| SES | free up to 62K/mo from EC2 |
| CloudWatch Logs | <$0.50 |
| ECR storage | <$0.10 |
| **Total** | **~$10-11/mo** |

Recommended: set a $50/mo AWS Budget with notifications at 80% actual, 100% actual, and 100% forecasted, sent to a monitored billing distribution group and the lab admin contact.

---

## Common gotchas

### "Could not assume role with OIDC"
- Most likely: the `sub` or `ref` claim in the OIDC token doesn't match the trust policy. Check that the workflow has `environment: production` (changes the `sub` format) and is running on the `main` branch.
- Less likely: the GhaDeployRole's trust policy is out of date. Redeploy the bootstrap stack.

### CODEOWNERS isn't requesting reviews
- Confirm the listed user is a **direct** collaborator, not just an org admin: `gh api repos/.../collaborators?affiliation=direct`. CODEOWNERS silently ignores users with only inherited permissions.
- Confirm the ruleset has `require_code_owner_review: true`.

### "GetParametersByPath ... not authorized"
- The IAM policy's `Resource` ARN must include both the path itself (`.../parameter/discord-bot/production`) AND the wildcard for children (`.../parameter/discord-bot/production/*`).

### CloudFormation rejects template with weird character errors
- EC2 security group descriptions and several other resources are ASCII-only. Em-dashes (`—`) and arrows (`→`) anywhere in the template cause cryptic "InvalidRequest" failures. Stick to ASCII in `Description` fields.

### Bot starts but can't access DynamoDB
- Check `DYNAMODB_TABLE_NAME` is in SSM and matches the actual table name (`discord-verification-production`). The bot defaults to `discord-verification` if unset, which doesn't exist.

### SES "Message rejected: Email address is not verified"
- We're still in the SES sandbox. Recipients must be verified. After production access is granted (post-cooldown re-application), this restriction lifts.

---

## Useful commands

```bash
# Get all stack outputs
aws cloudformation describe-stacks --stack-name discord-bot-production \
  --query 'Stacks[0].Outputs' --output table --region "$AWS_REGION"

# Resolve the instance ID once at the top of your shell session
INSTANCE_ID=$(aws cloudformation describe-stacks \
  --stack-name discord-bot-production \
  --query 'Stacks[0].Outputs[?OutputKey==`Ec2InstanceId`].OutputValue' \
  --output text --region "$AWS_REGION")

# What's currently running on the instance?
aws ssm send-command --instance-ids $INSTANCE_ID \
  --document-name AWS-RunShellScript \
  --parameters 'commands=["docker ps","docker inspect discord-bot --format {{.Config.Image}}"]' \
  --region "$AWS_REGION"

# Clear out a stuck container
aws ssm send-command --instance-ids $INSTANCE_ID \
  --document-name AWS-RunShellScript \
  --parameters 'commands=["docker rm -f discord-bot"]' \
  --region "$AWS_REGION"

# Restart bot without changing image
aws ssm send-command --instance-ids $INSTANCE_ID \
  --document-name AWS-RunShellScript \
  --parameters 'commands=["set -a && . /etc/discord-bot.envrc && set +a && /usr/local/bin/deploy.sh latest 2>&1"]' \
  --region "$AWS_REGION"

# What's in DynamoDB?
aws dynamodb scan --table-name discord-verification-production \
  --region "$AWS_REGION"
```
