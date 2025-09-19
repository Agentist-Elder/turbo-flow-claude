# 🚀 DevPods Setup for GitHub Codespaces

## ⚡ Quick Setup Methods

### **Method 1: GitHub Dev Container (Recommended)**

**For new Codespaces:**
1. Go to your GitHub repository
2. Click **Code** → **Codespaces** → **Configure dev container** (dropdown menu)
3. Paste the contents of `devpods/codespace.devcontainer.json` into your configuration
4. Commit to main branch
5. Create a new Codespace - setup runs automatically!

> **Note:** Once the devcontainer is added to your repo's main branch, all future Codespaces will automatically run the setup. Just go back to your repo's main page and launch a Codespace to watch the magic happen!

### **Method 2: Manual Setup (Existing Codespaces)**

If you already have a Codespace running, use the `boot_codespace.sh` script from the devpods directory:

```bash
#!/bin/bash
# Clone the repository
echo "Cloning repository..."
git clone https://github.com/marcuspat/turbo-flow-claude.git

# Check if clone was successful
if [ $? -ne 0 ]; then
    echo "Error: Failed to clone repository"
    exit 1
fi

# Navigate into the cloned directory
cd turbo-flow-claude

# Move devpods directory to parent directory
echo "Moving devpods directory..."
mv devpods ..

# Go back to parent directory
cd ..

# Remove the cloned repository
echo "Removing turbo-flow-claude directory..."
rm -rf turbo-flow-claude

# Make all shell scripts in devpods executable
echo "Making scripts executable..."
chmod +x ./devpods/*.sh

# Run the setup script
echo "Running codespace_setup.sh..."
./devpods/codespace_setup.sh

echo "Script completed!"
```

**To use:**
```bash
# Save as boot_codespace.sh and run
chmod +x boot_codespace.sh
./boot_codespace.sh

# Then connect to tmux
tmux attach -t workspace
```

---

## 📁 What Gets Installed

```
your-project/
├── devpods/                    # Setup scripts
├── agents/                     # AI agent library
├── cf-with-context.sh         # Context wrapper
├── CLAUDE.md                  # Claude development rules
├── FEEDCLAUDE.md              # Streamlined instructions
└── [project files]            # Your configured environment
```

---

## 🎯 Available Commands

```bash
cf "any task"              # General AI coordination
cf-swarm "build feature"   # Focused implementation
cf-hive "complex planning" # Multi-agent coordination
claude-monitor             # Usage tracking
```

---

## 🖥️ Tmux Workspace

Connect after setup:
```bash
tmux attach -t workspace
```

**Windows:**
- **0**: Primary Claude workspace
- **1**: Secondary Claude workspace  
- **2**: Claude monitor
- **3**: System monitor (htop)

**Navigation:**
- `Ctrl+b 0-3` - Switch windows
- `Ctrl+b d` - Detach session
- `Ctrl+b ?` - Help

---

## 💡 Quick Test

```bash
# After setup and connecting to tmux:
source ~/.bashrc
cf "Hello! Show me available agents"
```

---

## ⚠️ Troubleshooting

**Can't connect to tmux:**
```bash
tmux list-sessions
# If missing, run:
./devpods/tmux-workspace.sh
tmux attach -t workspace
```

**Commands not found:**
```bash
source ~/.bashrc
```

---

## 🎉 You're Ready!

**Workflow:**
1. **Setup**: Use devcontainer OR run `boot_codespace.sh`
2. **Connect**: `tmux attach -t workspace`  
3. **Build**: `cf-swarm "Help me build my app"`

✅ Complete AI development environment  
✅ Extensive agent library  
✅ Monitoring tools  
✅ 4-window tmux workspace  

**Remember:** Always work inside tmux for the best experience!
