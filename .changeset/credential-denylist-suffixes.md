---
"isnadibot": patch
---

A read of a credential file is now refused in the spellings people actually use. `prod.kubeconfig`, `bundle.jceks`, `vault.kdb`, `client.ovpn`, `key.gpg`, `pypirc`, `gradle.properties`, `settings.xml`, `nuget.config`, `_netrc` and `shadow` used to pass as ordinary reads, because the rule matched only the exact name or a hidden leading dot. They now ask for approval like every other credential store.
