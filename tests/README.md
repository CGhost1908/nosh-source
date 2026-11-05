# Tests

End-to-end tests drive the **real Electron app** with Playwright. Each test starts Nosh with a
throwaway profile and notes folder, so your own notes are never touched. If the profile is not
isolated the test refuses to run.

```bash
npm run check       # parse every .js file (seconds)
npm run test:e2e    # run all tests/*.e2e.js, one process each
npm test            # both
node tests/run-e2e.js smoke    # only files whose name contains "smoke"
```

Windows will briefly open and close Nosh windows while the tests run.

## Writing a test

Copy `smoke.e2e.js`. `helpers.js` gives you `createSandbox()` (temp notes), `launchNosh()`
(starts the app, returns `{ app, main, errors, ... }`), `waitFor()` and a `createReporter()` for
the PASS/FAIL lines. Exit the app with `forceExit()`: Nosh asks before closing with unsaved
changes, which would otherwise hang the test.

Name new files `<area>.e2e.js` and the runner picks them up.
