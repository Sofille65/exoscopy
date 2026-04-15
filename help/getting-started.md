# Getting Started

## What is ExoScopy?

ExoScopy is a web dashboard for [exo](https://github.com/exo-explore/exo) — the open-source framework that turns Apple Silicon Macs into a distributed AI inference cluster. It gives you a clean interface to chat with your models, monitor your cluster, manage models across nodes, and download new ones from HuggingFace.

## First Setup

1. Go to **Settings** and add your EXO nodes (name + IP address)
2. Click **Re-discover** to automatically find exo nodes on your network
3. Set the **EXO Endpoint** (IP of your master node, port 52415)
4. Click **Test** to verify connectivity
5. For model sync between nodes: enter passwords and click **Setup SSH Keys**

## Requirements

- One or more Mac with [exo](https://github.com/exo-explore/exo) running
- Nodes on the same local network
- SSH access to nodes (for model distribution and monitoring)
