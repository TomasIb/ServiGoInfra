#!/usr/bin/env node
/**
 * clean-db.mjs — Wipes all documents using Firebase CLI (bypasses security rules).
 * This version uses the Firebase CLI because it uses the user's login tokens.
 */
import { execSync } from 'child_process'
import readline from 'readline'
import 'dotenv/config'

const projectId = process.env.FIREBASE_PROJECT_ID || 'pruebaapp-11b43'

async function main() {
  console.log('\n🔥 ServiGo Database Cleaner (CLI MODE)\n')
  console.log(`Project: ${projectId}`)
  
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout })
  const answer = await new Promise(resolve => rl.question('\n⚠️ This will delete ALL collections and documents in Firestore. Proceed? (yes): ', resolve))
  rl.close()

  if (answer.toLowerCase() !== 'yes') {
    console.log('Aborted.')
    process.exit(0)
  }

  console.log('\nCleaning Firestore...')
  try {
    // We use firebase-tools directly. It's much faster and handles recursion/batches automatically.
    // We specify the project to be sure.
    execSync(`firebase firestore:delete --all-collections --force --project ${projectId}`, { stdio: 'inherit' })
    console.log('\n✅ Database wipe complete!')
    console.log('Next step: npm run seed:admin')
  } catch (err) {
    console.error('\n❌ Error cleaning database. Make sure you are logged in (firebase login).')
    process.exit(1)
  }
}

main().catch(console.error)
