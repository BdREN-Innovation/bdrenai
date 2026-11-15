# MFA, TOTP, WebAuthn & Passkeys Configuration Guide (ZITADEL v4)

All cryptographic authentication factors (passwords, TOTP secrets, WebAuthn/Passkey public keys, and recovery codes)
are managed exclusively by **ZITADEL v4** (`auth.bdren.ai`). Django never stores passwords, MFA secrets, or passkeys.

## 1. Enabling Passkeys, WebAuthn, and TOTP MFA in ZITADEL v4
In the ZITADEL Management Console (`https://auth.bdren.ai/ui/console` -> **Default Settings -> Login Behavior and Security**
or via the Admin v2 / Management v1 Login Policy API):
1. **Passwordless / Passkeys (`allowDomainDiscovery` + `passwordlessType`)**:
   - Set `PasswordlessType` to `PASSWORDLESS_TYPE_ALLOWED`.
   - Under **Multi-Factors**, enable **U2F / WebAuthn ( with PIN / Biometrics )** and **OTP (Authenticator App / TOTP)**.
2. **Enforcing MFA for Platform Administrators (`forceMfa` / `forceMfaLocalOnly`)**:
   - Enable `forceMfa: true` on the BDREN Administration Organization login policy so every administrator is required
     to enroll TOTP or a WebAuthn Passkey at login.
3. **HTTPS & Relying Party ID Requirement for WebAuthn**:
   - Browsers enforce that WebAuthn/Passkeys run on a secure context (`https://auth.bdren.ai` in production, or
     `*.localhost` in local development). Ensure `ZITADEL_EXTERNALDOMAIN=auth.bdren.ai` and `ZITADEL_EXTERNALSECURE=true`
     in production.
