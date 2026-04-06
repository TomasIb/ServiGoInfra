#!/bin/bash

# Script de Inicialización de Firebase para el Sistema de Pagos
# Este script te guiará paso a paso para configurar Firebase

echo "🔥 Configuración de Firebase para Sistema de Pagos"
echo "=================================================="
echo ""

# Verificar si Firebase CLI está instalado
if ! command -v firebase &> /dev/null
then
    echo "❌ Firebase CLI no está instalado"
    echo "📦 Instalando Firebase CLI..."
    npm install -g firebase-tools
fi

echo "✅ Firebase CLI instalado"
echo ""

# Login a Firebase
echo "🔐 Iniciando sesión en Firebase..."
firebase login

# Inicializar Firebase (si no está inicializado)
if [ ! -f "firebase.json" ]; then
    echo "📝 Inicializando Firebase..."
    firebase init functions firestore
else
    echo "✅ Firebase ya está inicializado"
fi

echo ""
echo "⚙️  Configurando variables de entorno..."
echo ""
echo "Para configurar Mercado Pago, necesitas tu Access Token."
echo "Obtén tu token en: https://www.mercadopago.com/developers/panel/credentials"
echo ""
read -p "Ingresa tu Mercado Pago Access Token (o presiona Enter para configurar después): " MP_TOKEN

if [ ! -z "$MP_TOKEN" ]; then
    firebase functions:config:set mercadopago.access_token="$MP_TOKEN"
    echo "✅ Access Token configurado"
else
    echo "⚠️  Recuerda configurar el token más tarde con:"
    echo "   firebase functions:config:set mercadopago.access_token=\"TU_TOKEN\""
fi

echo ""
echo "🚀 Desplegando Cloud Functions..."
read -p "¿Deseas desplegar las Cloud Functions ahora? (y/n): " DEPLOY

if [ "$DEPLOY" = "y" ] || [ "$DEPLOY" = "Y" ]; then
    firebase deploy --only functions
    echo "✅ Cloud Functions desplegadas"
    echo ""
    echo "📋 Copia la URL del webhook que aparece arriba"
    echo "   Debe ser algo como: https://us-central1-PROYECTO.cloudfunctions.net/webhookMercadoPago"
    echo ""
    echo "🔗 Configura esta URL en Mercado Pago:"
    echo "   1. Ve a https://www.mercadopago.com/developers/panel/webhooks"
    echo "   2. Crea un nuevo webhook"
    echo "   3. Pega la URL del webhook"
    echo "   4. Selecciona eventos: Pagos"
else
    echo "⚠️  Recuerda desplegar más tarde con: firebase deploy --only functions"
fi

echo ""
echo "✅ Configuración completada!"
echo ""
echo "📚 Próximos pasos:"
echo "   1. Configura el webhook en Mercado Pago (si no lo hiciste)"
echo "   2. Actualiza las reglas de Firestore (ver configuracion_pagos.md)"
echo "   3. Ejecuta: npm start"
echo "   4. Prueba el flujo de pago en modo sandbox"
echo ""
