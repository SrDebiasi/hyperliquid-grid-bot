module.exports = {
    apps: [
        {
            name: 'gridbot-api',
            script: 'src/api/server.js',
            cwd: '/app',
            interpreter: 'node',
            autorestart: true,
            watch: false,
            time: true,
            max_restarts: 3,
            env: {
                NODE_ENV: 'production',
                PM2_HOME: '/app/.pm2',
            },
        },
    ],
};
