---
"@isnadi/contracts": patch
---

A delegated bot can no longer read a credential file in a folder you granted it. Hidden names such as `.npmrc` and `.ssh`, and names such as `id_rsa`, `*.pem`, `credentials.json` or `terraform.tfstate`, now need your approval, and a delegation that cannot ask anyone refuses them with a reason.
