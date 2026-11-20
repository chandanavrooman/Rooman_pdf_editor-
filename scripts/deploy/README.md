# Deploying Rooman PDF to a Debian / Ubuntu container

Two files do the work:

| File | Where it runs | What it does |
|---|---|---|
| `deploy-to-container.ps1` | your Windows PC | builds the website, packs the project, sends it to the container over SSH and starts the installer |
| `install-debian.sh` | inside the container | installs Ghostscript, LibreOffice and Tesseract, the Python backend and the AI tool server (systemd services) and nginx |

Nothing is committed or pushed, and your local `.env` is never sent: the container makes its own secrets.

## 1. Get the container ready (once)

In Proxmox open the container's **Console** and log in as root.

```bash
ip -4 addr show        # the container's IP address (the Proxmox address is a different one)
apt update && apt install -y openssh-server sudo
```

If the **IPs** line on the container's Summary page is empty, check the **Network** tab: the interface needs an IP (DHCP or a fixed address) and a gateway.

A fresh Debian container does not let `root` log in over SSH with a password. Pick one:

```bash
# A) use a normal user with sudo (recommended)
adduser deploy && usermod -aG sudo deploy
echo 'deploy ALL=(ALL) NOPASSWD:ALL' > /etc/sudoers.d/deploy     # the installer runs sudo without a prompt

# B) or allow root with a password (simpler, less safe)
sed -i 's/^#\?PermitRootLogin.*/PermitRootLogin yes/' /etc/ssh/sshd_config && systemctl restart ssh
```

## 2. Deploy (from this PC, in the project folder)

```powershell
.\scripts\deploy\deploy-to-container.ps1 -Server 192.168.1.60 -User deploy
```

- `-Server`: the container's IP (or name).
- `-User`: `deploy` for option A, or leave out for `root`.
- `-Origin http://192.168.1.60`: the address people type in the browser. It defaults to `http://<Server>`; set it to your real address, for example `https://pdf.example.com` once you have HTTPS.
- `-NoRegistration`: on the first install, stop strangers creating accounts.
- `-SkipBuild`: reuse the website already built.

When it finishes it prints which server tools are ready, then the address to open.

## 3. After the first install

- **AI assistant:** put your key in `/opt/rooman-pdf/.env` (`AI_API_KEY=...`, and `AI_ENDPOINT` / `AI_MODEL` if you do not use the defaults), then `sudo systemctl restart rooman-pdf-backend`. Without a key every PDF tool still works; the AI answers "AI_KEY_MISSING".
- **First user:** open the site and create an account (the server tools need a signed-in user).
- **Update later:** run the same command again. Your `.env`, users and files are kept.

## Good to know

- Uploaded and generated files are deleted automatically after `FILE_TTL_MINUTES` (60). The database is `/var/lib/rooman-pdf/rooman.db`; back that up together with `/opt/rooman-pdf/.env` if you keep accounts.
- HTML to PDF uses Chromium, started without its own sandbox (`CHROMIUM_NO_SANDBOX=true` in `.env`) because a service with `NoNewPrivileges` cannot create one. Instead the page it draws is locked down: no scripts, no network, no access to other files. Do not point `CHROMIUM_PATH` at a browser you also use for browsing.
- Keep the backend at one worker (the install does): the rate limiter and the pending-confirmation list live in memory.
- The site is served on plain HTTP (port 80). For HTTPS put a reverse proxy in front (Proxmox host proxy, Nginx Proxy Manager, Caddy) or run `certbot --nginx` in the container if it has a public domain, then deploy with `-Origin https://your-domain`.
- Chat with PDF sends the extracted text of the document to the AI provider you configure. Say so to your users.

## Logs and checks (on the container)

```bash
systemctl status rooman-pdf-backend rooman-pdf-mcp nginx
journalctl -u rooman-pdf-backend -f
curl -s http://127.0.0.1:8000/api/system/capabilities      # which tools are ready, and whether the AI key is set
```
