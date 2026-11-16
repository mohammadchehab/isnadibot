---
"@isnadi/contracts": patch
---

A delegated read no longer reaches a keystore or a credential file whose name carries no dot. Key bundles such as `.p12`, `.pfx`, `.jks`, `.p8`, `.ppk`, `.kdbx` and `auth.json`, and the dotless `netrc`, `npmrc` and `kubeconfig`, now ask for approval like the credential files we already refused.
