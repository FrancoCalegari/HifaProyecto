# 🚀 Guía de Despliegue en Producción en Vercel (Hifa SaaS)

Esta guía explica cómo desplegar **Hifa** en **Vercel** como una versión SaaS administrada en la nube, pensada para usuarios que no desean configurar Docker ni un servidor local (self-hosted).

---

## 🏗️ Arquitectura en Vercel

```
                                      ┌────────────────────────┐
                                      │   Usuarios / Parejas   │
                                      └───────────┬────────────┘
                                                  │ HTTPS
                                                  ▼
                                      ┌────────────────────────┐
                                      │  Vercel Edge Network   │
                                      │   (CDN Global / SSL)   │
                                      └─────┬────────────┬─────┘
                     Archivos Estáticos     │            │  Rutas /api/*
                  (public/ styles, js)     │            │  (Vercel Serverless)
                                            ▼            ▼
                                    ┌──────────┐  ┌───────────────┐
                                    │ Frontend │  │  api/index.js │
                                    └──────────┘  └───────┬───────┘
                                                          │
                                     SQLite en /tmp ◄─────┤
                               (ultra rápido en memoria)  │ Sincronización automática
                                                          ▼
                                            ┌───────────────────────────┐
                                            │ SpiderWebAPI (Cloud)      │
                                            │ - Base de Datos Snapshot  │
                                            │ - Almacenamiento Fotos    │
                                            │ - SpiderIA para Planes    │
                                            └───────────────────────────┘
```

1. **Frontend**: Vercel sirve automáticamente todos los archivos estáticos desde `public/` con compresión Brotli/Gzip, HTTP/2 y caché en su red global.
2. **Backend Serverless**: Las peticiones a `/api/*` y `/api/v1/*` son atendidas por la Serverless Function en `api/index.js` (Node.js 22+).
3. **Persistencia en la Nube**:
   - Al iniciar en frío (*cold start*), el sistema recupera el último snapshot de `hifa.db` desde SpiderWebAPI Cloud Storage.
   - Cada vez que una pareja registra un gasto, tarea, nota, registro menstrual o foto, el sistema sincroniza automáticamente la base de datos y archivos en segundo plano con SpiderWebAPI.

---

## 📋 Pasos para Desplegar

### Paso 1: Subir el proyecto a GitHub
Si aún no lo tienes en GitHub:
```bash
git add .
git commit -m "feat: preparar despliegue en producción para Vercel"
git push origin main
```

### Paso 2: Importar en Vercel
1. Ingresa a [vercel.com](https://vercel.com/) e inicia sesión.
2. Haz clic en **"Add New..."** → **"Project"**.
3. Selecciona tu repositorio de GitHub `HifaProyecto`.
4. En la configuración del proyecto:
   - **Framework Preset**: Dejar en `Other` (detectado automáticamente).
   - **Root Directory**: `./` (raíz).
   - **Build Command**: Dejar vacío.
   - **Output Directory**: Dejar vacío (usa la configuración de `vercel.json`).

### Paso 3: Configurar Variables de Entorno en Vercel
En la sección **"Environment Variables"** de Vercel, agrega las siguientes claves:

| Variable | Valor Recomendado | Descripción |
|---|---|---|
| `spiderwebdbname` | `sw_Franco Calegari_hifaRemote` | Nombre de base de datos en SpiderWebAPI |
| `spiderapikey` | `a6ccadadd08b030c1acbe89bbe66c202b6c9658736165072ab3fa5719b3749cf` | API Key secreta de SpiderWebAPI |
| `spidercloudstrogaeid` | `47` | ID del proyecto de Cloud Storage |
| `SPIDERWEB_API_URL` | `https://spiderwebargapi.com.ar/api/v1` | URL base de SpiderWebAPI |
| `STORAGE_MODE` | `spiderweb` | Modo de almacenamiento en la nube |
| `ADMIN_EMAIL` | `admin@hifa.saas` *(o tu correo personal)* | Correo del administrador para el panel `/admin` |
| `ADMIN_PASSWORD` | *(Tu contraseña segura)* | Contraseña del administrador |

### Paso 4: Desplegar
Haz clic en **"Deploy"**. Vercel compilará la función serverless y desplegará el frontend en segundos, entregándote un dominio HTTPS gratuito (por ejemplo `https://hifa-proyecto.vercel.app`).

---

## ✅ Verificación Post-Despliegue

1. **Prueba de Acceso de Usuario**:
   - Abre la URL provista por Vercel.
   - Registra dos cuentas de prueba.
   - Copia el código de vinculación (`HIFA-XXXXXX`) y vincúlalas.
   - Verifica que el Dashboard, Economía, Tareas, Listas, Ciclo Menstrual y Calendario funcionen correctamente.

2. **Prueba del Panel de Administración**:
   - Ingresa a `https://tu-dominio.vercel.app/admin`.
   - Inicia sesión con las credenciales de `ADMIN_EMAIL` y `ADMIN_PASSWORD`.
   - Observa la tarjeta **"Entorno de Ejecución & Sincronización en la Nube"**: indicará `Vercel Serverless Production` y la fecha de sincronización.
   - Puedes hacer clic en **"Sincronizar Base de Datos Ahora"** para verificar la conexión directa con SpiderWebAPI.

3. **Dominio Personalizado (Opcional)**:
   - En el Dashboard de tu proyecto en Vercel, ve a **Settings** → **Domains**.
   - Agrega tu propio dominio (ej: `app.midominio.com`).
   - Configura el registro CNAME que Vercel te indique. Vercel emitirá automáticamente el certificado SSL gratuito.

---

## 🔒 Privacidad y Multi-Inquilino (Multi-Tenant)
- Cada pareja tiene sus datos totalmente aislados mediante el identificador `couple_id`.
- Los usuarios regulares **no ven ni necesitan configurar** motores de base de datos ni carpetas; su experiencia es 100% como un SaaS comercial listo para usar.
- Solo los usuarios con rol `admin` tienen acceso al panel `/admin`.

