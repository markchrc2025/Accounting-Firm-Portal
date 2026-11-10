_Fingerprint `api-low-verbose-error`._

An invented weakness in the sample service (low).

**Severity:** low. **Confidence:** high.

- Likelihood (low): Invented reason for low.
- Impact (low): Invented reason for low.
- Confidence (high): Reproduced locally.

### Root cause

The handler in src/sample/api-low-verbose-error.ts trusts a value the caller controls.

### Intended behaviour

The handler should check the value against the signed-in account before using it.

### Trace

- **entrypoint** `src/sample/api-low-verbose-error.ts:14` (handle): The route reads the value from the request.
- **sink** `src/sample/store.ts:88` (save): The value is stored without a check.

### Evidence

- `src/sample/api-low-verbose-error.ts:20`: No ownership check precedes the call.

### Conditions

- authentication level: Any signed-in user.

### Reproduction

Attacker: A signed-in user of another account.

1. Start the sample service locally.
2. Send the payload to the route as the second user.

```
{"accountId":"other-account"}
```

Observed: The service stored the record under the other account.

### Fix

Compare the value with the session account and refuse a mismatch.

`src/sample/api-low-verbose-error.ts`

```
if (body.accountId !== session.accountId) throw forbidden();
```
