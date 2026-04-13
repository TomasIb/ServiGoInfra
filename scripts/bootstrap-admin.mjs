#!/usr/bin/env node
/**
 * bootstrap-admin.mjs — Automates the "maintenance rules sandwich" to seed the first admin.
 * 1. Backs up production rules.
 * 2. Deploys maintenance rules (allow read/write: if true).
 * 3. Runs the seed script (Client SDK).
 * 4. Restores and deploys production rules.
 */
import { execSync } from 'child_process'
import fs from 'fs'
import path from 'path'

const RULES_PATH = 'rules/firestore.rules'
const MAINT_RULES_PATH = 'rules/firestore.rules.maintenance'
const BACKUP_PATH = 'rules/firestore.rules.bak'

function run(cmd) {
  console.log(`\n> ${cmd}`)
  execSync(cmd, { stdio: 'inherit' })
}

async function main() {
  console.log('\n🚀 Bootstrapping Admin User (Secure Mode)\n')

  // 1. Check files
  if (!fs.existsSync(RULES_PATH)) throw new Error('rules/firestore.rules not found')
  if (!fs.existsSync(MAINT_RULES_PATH)) throw new Error('rules/firestore.rules.maintenance not found')

  try {
    // 2. Backup current rules
    console.log('📦 Backing up production rules...')
    fs.copyFileSync(RULES_PATH, BACKUP_PATH)

    // 3. Switch to maintenance rules
    console.log('🔧 Switching to maintenance rules...')
    fs.copyFileSync(MAINT_RULES_PATH, RULES_PATH)

    // 4. Deploy maintenance rules
    console.log('📡 Deploying maintenance rules...')
    run('firebase deploy --only firestore:rules')

    // 5. Wait for propagation
    console.log('⏳ Waiting 30s for rules to propagate...')
    await new Promise(resolve => setTimeout(resolve, 30000))

    // 6. Run seed script
    console.log('🌱 Seeding admin...')
    run('node scripts/seed-config.mjs --admin')

  } catch (err) {
    console.error('\n❌ ERROR during bootstrap:', err.message)
  } finally {
    // 6. Restore original rules
    console.log('\n🛡 Restoring production rules...')
    if (fs.existsSync(BACKUP_PATH)) {
      fs.copyFileSync(BACKUP_PATH, RULES_PATH)
      fs.unlinkSync(BACKUP_PATH)
    }

    // 7. Deploy production rules
    console.log('📡 Re-deploying production rules...')
    run('firebase deploy --only firestore:rules')

    console.log('\n✨ Done!')
  }
}

main()
