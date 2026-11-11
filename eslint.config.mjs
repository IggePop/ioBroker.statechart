// ioBroker eslint template configuration file for js and ts files
// Please note that esm or react based modules need additional modules loaded.
import config, { reactConfig } from '@iobroker/eslint-config';

export default [
    ...config,
    {
        // specify files to exclude from linting here
        ignores: [
            '.dev-server/',
            '.vscode/',
            '**/*.test.ts',
            'test/**/*.js',
            '*.config.mjs',
            'build',
            'dist',
            'admin/words.js',
            'admin/admin.d.ts',
            'admin/blockly.js',
            '**/adapter-config.d.ts',
            'widgets/**/*.js',
            'admin/build',
            // the bundle of the tab built by "watch:react" for the dev-server
            'admin/.watch',
        ],
    },
    // the admin UI is a React app, which runs in the browser
    ...reactConfig.map(c => ({ ...c, files: ['admin/src/**/*.{ts,tsx}'] })),
    {
        files: ['admin/src/**/*.{ts,tsx}'],
        languageOptions: {
            globals: {
                document: 'readonly',
                window: 'readonly',
            },
        },
    },
    {
        // you may disable some 'jsdoc' warnings - but using jsdoc is highly recommended
        // as this improves maintainability. jsdoc warnings will not block build process.
        rules: {
            // 'jsdoc/require-jsdoc': 'off',
            // 'jsdoc/require-param': 'off',
            // 'jsdoc/require-param-description': 'off',
            // 'jsdoc/require-returns-description': 'off',
            // 'jsdoc/require-returns-check': 'off',
        },
    },
];
