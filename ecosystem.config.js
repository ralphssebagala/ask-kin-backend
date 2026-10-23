module.exports = {
  apps: [{
    name: "ask-kin-api",
    cwd: "C:/Users/Ralph A Ssebagala/ask-kin-backend",
    script: "server.js",
    exec_mode: "fork",
    autorestart: true,
    watch: false,
    max_restarts: 10,
    env: {
      NODE_ENV: "production",
      PORT: 5000
    }
  }]
}