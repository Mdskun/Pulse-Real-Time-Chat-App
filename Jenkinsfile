pipeline {
    agent any

    environment {
        DOCKER_REGISTRY = "docker.io"
        BACKEND_IMAGE   = "mdskun/chatapp_backend"
        FRONTEND_IMAGE  = "mdskun/chatapp_frontend"
        K8S_NAMESPACE   = "realtime-chat"
        K8S_SLAVE_HOST  = "k-slave"
        K8S_SLAVE_USER  = "ec2-user"
        SSH_KEY_PATH    = "/var/lib/jenkins/key"
        // Reused on every ssh call: these two EC2s are internal infra Jenkins owns,
        // so we don't pin host keys - avoids "REMOTE HOST IDENTIFICATION HAS CHANGED"
        // failures whenever k-slave is stopped/restarted and gets a new host key.
        SSH_OPTS        = "-o StrictHostKeyChecking=no -o UserKnownHostsFile=/dev/null"
        REPO_URL        = "https://github.com/Mdskun/Real-Time-Chat-Application.git"
        REPO_DIR        = "Real-Time-Chat-Application"
    }

    stages {

        // ─── Stage 0: Resolve a public hostname for k-slave ──────────────────
        // We don't hardcode chat.local (that's only usable if you edit /etc/hosts
        // yourself). Instead we ask k-slave for its own public IP and build a
        // nip.io hostname from it - nip.io resolves "chat.<ip>.nip.io" to <ip>
        // automatically, no DNS setup needed. Works whether the EIP is static
        // or the public IP changes on reboot, since it's re-resolved every run.
        stage('Resolve Chat Host') {
            steps {
                script {
                    def slaveIp = sh(
                        script: '''
                            ssh -i "${SSH_KEY_PATH}" ${SSH_OPTS} \
                                "${K8S_SLAVE_USER}@${K8S_SLAVE_HOST}" "curl -s ifconfig.me"
                        ''',
                        returnStdout: true
                    ).trim()

                    env.CHAT_HOST   = "chat.${slaveIp}.nip.io"
                    // Vite bakes VITE_* into the JS bundle at build time (matches
                    // frontend/Dockerfile's ARG names exactly: VITE_API_URL / VITE_WS_URL).
                    // These must be URLs the *browser* can reach, not an in-cluster service name.
                    env.VITE_API_URL = "http://${env.CHAT_HOST}/api"
                    env.VITE_WS_URL  = "ws://${env.CHAT_HOST}/ws"
                    echo "Resolved k-slave public IP: ${slaveIp}"
                    echo "Chat host for this deploy: ${env.CHAT_HOST}"
                }
            }
        }

        // ─── Stage 1: Build & push images ────────────────────────────────────
        stage('Build & Push Images') {
            steps {
                withCredentials([
                    usernamePassword(
                        credentialsId: '6bb7cd36-f983-497a-bae2-c55ce36c04fb',
                        usernameVariable: 'DOCKER_USER',
                        passwordVariable: 'DOCKERPASS'
                    )
                ]) {
                    sh '''
                        sudo systemctl restart docker
                        echo "$DOCKERPASS" | docker login --username "$DOCKER_USER" --password-stdin

                        # Frontend: build args MUST match frontend/Dockerfile's ARG names
                        # (VITE_API_URL / VITE_WS_URL) or Vite silently falls back to its
                        # localhost defaults and the deployed bundle can't reach the backend.
                        docker build \
                            --build-arg VITE_API_URL="${VITE_API_URL}" \
                            --build-arg VITE_WS_URL="${VITE_WS_URL}" \
                            --network=host \
                            -t "${DOCKER_REGISTRY}/${FRONTEND_IMAGE}:latest" \
                            -t "${DOCKER_REGISTRY}/${FRONTEND_IMAGE}:${BUILD_NUMBER}" \
                            ./frontend

                        docker push "${DOCKER_REGISTRY}/${FRONTEND_IMAGE}:latest"
                        docker push "${DOCKER_REGISTRY}/${FRONTEND_IMAGE}:${BUILD_NUMBER}"

                        docker build --network=host \
                            -t "${DOCKER_REGISTRY}/${BACKEND_IMAGE}:latest" \
                            -t "${DOCKER_REGISTRY}/${BACKEND_IMAGE}:${BUILD_NUMBER}" \
                            ./backend

                        docker push "${DOCKER_REGISTRY}/${BACKEND_IMAGE}:latest"
                        docker push "${DOCKER_REGISTRY}/${BACKEND_IMAGE}:${BUILD_NUMBER}"
                    '''
                }
            }
        }

        // ─── Stage 2: Deploy to Kubernetes (remote slave) ────────────────────
        stage('Deploy to K8s') {
            steps {
                withCredentials([
                    usernamePassword(
                        credentialsId: '6bb7cd36-f983-497a-bae2-c55ce36c04fb',
                        usernameVariable: 'DOCKER_USER',
                        passwordVariable: 'DOCKERPASS'
                    ),
                    string(credentialsId: 'DJANGO_SECRET_KEY',         variable: 'DJANGO_SECRET_KEY'),
                    string(credentialsId: 'POSTGRES_PASSWORD',         variable: 'POSTGRES_PASSWORD'),
                    string(credentialsId: 'DJANGO_SUPERUSER_USERNAME', variable: 'DJANGO_SUPERUSER_USERNAME'),
                    string(credentialsId: 'DJANGO_SUPERUSER_PASSWORD', variable: 'DJANGO_SUPERUSER_PASSWORD'),
                    string(credentialsId: 'DJANGO_SUPERUSER_EMAIL',    variable: 'DJANGO_SUPERUSER_EMAIL')
                ]) {
                    // Pass credentials as explicit SSH -o SendEnv vars rather than inside
                    // a heredoc, so withCredentials masking works correctly on the remote side.
                    // CHAT_HOST is also forwarded so the deploy script can substitute it
                    // into the checked-in "chat.local" placeholder at apply time only -
                    // the files in k8s/ stay chat.local for local/dev use.
                    sh '''
                        # Copy repo to slave (or update it). Uses fetch + reset --hard against
                        # origin/HEAD instead of "git pull" so it never assumes a branch name
                        # (works whether the default branch is master, main, or anything else,
                        # and never fails on local drift/conflicts on the slave).
                        ssh -i "${SSH_KEY_PATH}" ${SSH_OPTS} \
                            "${K8S_SLAVE_USER}@${K8S_SLAVE_HOST}" \
                            "if [ -d ${REPO_DIR}/.git ]; then \
                                cd ${REPO_DIR} && git fetch origin && git reset --hard origin/HEAD; \
                             else \
                                git clone ${REPO_URL} ${REPO_DIR}; \
                             fi"

                        # Write a temp env file on the slave with credentials
                        # (ssh passes the values as args — never stored in shell history)
                        ssh -i "${SSH_KEY_PATH}" ${SSH_OPTS} \
                            "${K8S_SLAVE_USER}@${K8S_SLAVE_HOST}" \
                            "cat > /tmp/deploy_env.sh << 'ENVEOF'
export DOCKER_USER='${DOCKER_USER}'
export DOCKERPASS='${DOCKERPASS}'
export DJANGO_SECRET_KEY='${DJANGO_SECRET_KEY}'
export POSTGRES_PASSWORD='${POSTGRES_PASSWORD}'
export DJANGO_SUPERUSER_USERNAME='${DJANGO_SUPERUSER_USERNAME}'
export DJANGO_SUPERUSER_PASSWORD='${DJANGO_SUPERUSER_PASSWORD}'
export DJANGO_SUPERUSER_EMAIL='${DJANGO_SUPERUSER_EMAIL}'
export CHAT_HOST='${CHAT_HOST}'
ENVEOF
chmod 600 /tmp/deploy_env.sh"

                        # Run the full deploy script on the slave
                        ssh -i "${SSH_KEY_PATH}" ${SSH_OPTS} \
                            "${K8S_SLAVE_USER}@${K8S_SLAVE_HOST}" bash << 'SCRIPT'
set -e
source /tmp/deploy_env.sh

echo "$DOCKERPASS" | docker login --username "$DOCKER_USER" --password-stdin

cd Real-Time-Chat-Application

# ── Apply manifests in dependency order (filenames match k8s/ exactly) ───────
# 1. Namespace first (everything else goes inside it)
kubectl apply -f k8s/00-namespace.yaml

# 2. ConfigMap - substitute the real chat host in place of the chat.local
#    default that's checked into git (that default is only for local /etc/hosts dev).
sed "s/chat\\.local/${CHAT_HOST}/g" k8s/01-configmap.yaml | kubectl apply -f -

# 3. Secret "chat-secrets" — this is what k8s/10-postgres.yaml and k8s/20-backend.yaml
#    actually reference via secretKeyRef/secretRef. Use dry-run + apply so re-runs
#    don't error with "already exists", and real credentials override the
#    k8s/02-secrets.yaml placeholder values checked into git.
kubectl create secret generic chat-secrets \
  --namespace=realtime-chat \
  --from-literal=DJANGO_SECRET_KEY="$DJANGO_SECRET_KEY" \
  --from-literal=POSTGRES_PASSWORD="$POSTGRES_PASSWORD" \
  --from-literal=DJANGO_SUPERUSER_USERNAME="$DJANGO_SUPERUSER_USERNAME" \
  --from-literal=DJANGO_SUPERUSER_PASSWORD="$DJANGO_SUPERUSER_PASSWORD" \
  --from-literal=DJANGO_SUPERUSER_EMAIL="$DJANGO_SUPERUSER_EMAIL" \
  --dry-run=client -o yaml | kubectl apply -f -

# 4. Database (Deployment "db" + Service "db" + PVC, all in one file,
#    same as the "db" service in docker-compose.yml)
kubectl apply -f k8s/10-postgres.yaml

# 4.5 Redis (matches docker-compose.yml's "redis" service)
kubectl apply -f k8s/11-redis.yaml

# 5. Wait for the db Deployment to be ready before applying backend
#    (entrypoint.sh's migrate step needs postgres reachable)
echo "Waiting for db deployment to be ready..."
if ! kubectl rollout status deployment/db -n realtime-chat --timeout=300s; then
  echo "❌ Postgres failed. Dumping logs..."
  kubectl describe deployment db -n realtime-chat
  kubectl logs -l app=db -n realtime-chat --tail=100
  exit 1
fi

# 6. Run migrations exactly once via a Job (single runner) before the
#    backend rollout. The backend pods below boot Daphne directly;
#    entrypoint.sh's own migrate stays as a no-op safety net.
kubectl apply -f k8s/15-migrations.yaml
if ! kubectl wait --for=condition=complete job/chat-migrations -n realtime-chat --timeout=300s; then
  echo "❌ Migrations failed. Dumping logs..."
  kubectl logs job/chat-migrations -n realtime-chat --tail=100
  exit 1
fi

# 7. Backend (entrypoint.sh runs collectstatic/createsuperuser automatically on boot)
kubectl apply -f k8s/20-backend.yaml
kubectl rollout status deployment/backend -n realtime-chat --timeout=120s

# 8. Frontend
kubectl apply -f k8s/21-frontend.yaml
kubectl rollout restart deployment/frontend -n realtime-chat
if ! kubectl rollout status deployment/frontend -n realtime-chat --timeout=120s; then
  echo "❌ Frontend failed. Dumping debug info..."

  kubectl get pods -n realtime-chat
  kubectl describe deployment frontend -n realtime-chat
  kubectl logs -l app=frontend -n realtime-chat --tail=50

  exit 1
fi

# 9. Ingress - same substitution as the ConfigMap, real host in, chat.local out.
sed "s/chat\\.local/${CHAT_HOST}/g" k8s/30-ingress.yaml | kubectl apply -f -

# ── Cleanup temp creds file ───────────────────────────────────────────────────
rm -f /tmp/deploy_env.sh

echo ""
echo "✅ Deploy complete"
kubectl get pods -n realtime-chat
echo ""
echo "🌐 Application is accessible at:"
echo "👉 http://${CHAT_HOST}"
SCRIPT
                    '''
                }
            }
        }
    }

    // ─── Post: notify on success/failure ─────────────────────────────────────
    post {
        success {
            echo "✅ Pipeline succeeded — build #${BUILD_NUMBER} is live at http://${env.CHAT_HOST}"
        }
        failure {
            echo "❌ Pipeline failed at stage. Check logs above."
            // Add email / Slack notification here if needed:
            // slackSend channel: '#deploys', message: "❌ Build ${BUILD_NUMBER} failed."
        }
        always {
            // Clean up local docker images to avoid disk fill on the Jenkins node
            sh '''
                docker rmi "${DOCKER_REGISTRY}/${FRONTEND_IMAGE}:${BUILD_NUMBER}" || true
                docker rmi "${DOCKER_REGISTRY}/${BACKEND_IMAGE}:${BUILD_NUMBER}"  || true
            '''
        }
    }
}
