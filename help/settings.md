# Settings

## Nodes

Add and manage your exo cluster nodes:

- **Add node** — enter a name and IP address
- **Remove** — click the trash icon next to a node
- **Re-discover** — scan your LAN for exo nodes on port 52415 (auto-detects all nodes)

## SSH Keys

Required for model distribution (rsync) and node monitoring:

1. Enter the password for each node
2. Click **Setup SSH Keys** — this installs SSH keys from the ExoScopy container to each node, and between nodes
3. One-time setup — keys persist across container restarts

On macOS nodes, enable **Remote Login** in System Settings → General → Sharing.

## Config Check

Verify that each node is properly configured:

- SSH connectivity
- exo API reachable
- Python installed
- huggingface_hub available
- rsync available
- Model path accessible
- Disk free space

## EXO Endpoint

The IP and port of your exo master node (default port: 52415). Click **Test** to verify connectivity.

## OpenRouter (Cloud Fallback)

Optional. Add your OpenRouter API key (`sk-or-...`) to access cloud models alongside local exo models:

- GPT-4, Claude, Gemini, Llama, Mistral, and more
- Toggle between EXO and Cloud in the Chat tab
- Get your key at [openrouter.ai](https://openrouter.ai)

## Admin Mode

Enable multi-user access with authentication:

- **Admin password** — set a password to protect settings
- **User management** — create users with roles (admin / user)
- **Guest mode** — allow limited access without login (configurable token limit)

Users log in with username/password. Admins can manage users and settings. Regular users can only chat.
