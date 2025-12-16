// *** CONSTANTES DE TU APP AZOR-CALIDAD-NETLIFY ***
const AUTH0_DOMAIN = "dev-8nfvmq7g3rifqdu4.us.auth0.com";
const AUTH0_CLIENT_ID = "pQcvfNTw848DR4DtRKKUN8nxcsquGkAo"; 
const AZOR_API_AUDIENCE = "https://azor-calidad.netlify.app"; // Identificador de tu API

let auth0Client = null;

// Función auxiliar para decodificar JWT (Access Token)
function parseJwt(token) {
    if (!token) return null;
    try {
        const base64Url = token.split('.')[1];
        const base64 = base64Url.replace(/-/g, '+').replace(/_/g, '/');
        const jsonPayload = decodeURIComponent(atob(base64).split('').map(function(c) {
            return '%' + ('00' + c.charCodeAt(0).toString(16)).slice(-2);
        }).join(''));
        return JSON.parse(jsonPayload);
    } catch (e) {
        console.error("Error decodificando JWT:", e);
        return null;
    }
}

// Inicializa el cliente de Auth0
const configureClient = async () => {
    auth0Client = await auth0.createAuth0Client({
        domain: AUTH0_DOMAIN,
        clientId: AUTH0_CLIENT_ID,
        authorizationParams: {
            redirect_uri: window.location.origin,
            audience: AZOR_API_AUDIENCE, // Token para la API
            scope: 'openid profile email' // Aseguramos los scopes mínimos
        }
    });
};

// Maneja el regreso desde la página de login de Auth0
const handleRedirectCallback = async () => {
    const query = window.location.search;
    if (query.includes("code=") && query.includes("state=")) {
        try {
            await auth0Client.handleRedirectCallback();
            window.history.replaceState({}, document.title, window.location.pathname);
        } catch (err) {
            console.error("Error al procesar el callback de Auth0:", err);
        }
    }
};

// Inicia el proceso de Login (redirige a Auth0)
const login = async () => {
    await auth0Client.loginWithRedirect({
         authorizationParams: {
            audience: AZOR_API_AUDIENCE 
         }
    });
};

// Cierra la sesión
const logout = () => {
    auth0Client.logout({
        logoutParams: {
            returnTo: window.location.origin
        }
    });
};

// Función auxiliar para ocultar todos los enlaces si no están autenticados
const hideAllRestrictedLinks = (kpis, dashboard, admin) => {
    if (kpis) kpis.style.display = 'none';
    if (dashboard) dashboard.style.display = 'none';
    if (admin) admin.style.display = 'none';
};

// Función principal de inicialización que DEBE ser llamada en cada página
const initializeAuth = async (authRequired = false, requiredRoles = []) => {
    await configureClient();
    await handleRedirectCallback();
    await updateUI(authRequired, requiredRoles); // Pasa los parámetros
};

// Actualiza la interfaz para mostrar/ocultar contenido y aplicar restricciones por rol
const updateUI = async (authRequired, requiredRoles) => {
    const isAuthenticated = await auth0Client.isAuthenticated();
    
    // Elementos de la interfaz general
    const protectedContent = document.getElementById('protected-content');
    const loginScreen = document.getElementById('login-screen');
    const logoutButton = document.getElementById('logout-button');
    
    // Elementos de menú que controlaremos por ID (DEBEN COINCIDIR CON LOS ID DEL HTML)
    const kpisLink = document.getElementById('link-kpis');
    const dashboardAjustesLink = document.getElementById('link-dashboard-ajustes');
    const adminMantenimientoLink = document.getElementById('link-admin-mantenimiento');

    // 🛑 AJUSTE CLAVE: Ocultar todo al inicio para evitar el flasheo 🛑
    // Solo mostramos el contenido correcto al final del proceso de validación.
    if(protectedContent) protectedContent.style.display = 'none';
    if(loginScreen) loginScreen.style.display = 'none';

    // === LÓGICA DE BLOQUEO DE PÁGINAS PROTEGIDAS (NO AUTENTICADO) ===
    if (!isAuthenticated) {
        if (authRequired) {
             console.log("Página protegida. Usuario no autenticado. Redirigiendo a login.");
             // Redirige a Auth0. El callback volverá a esta misma página.
             await login(); 
             return; // Detiene la ejecución en la subpágina
        }

        // Si la página NO requiere autenticación (index.html):
        // Mostrar solo la pantalla de login.
        if(loginScreen) loginScreen.style.display = 'block';
        if(logoutButton) logoutButton.style.display = 'none';
        
        // Ocultamos todos los enlaces restringidos
        hideAllRestrictedLinks(kpisLink, dashboardAjustesLink, adminMantenimientoLink);
        return;
    }
    
    // Si está autenticado...
    
    // ----------------------------------------------------
    // LÓGICA DE RESTRICCIÓN POR ROLES: LEYENDO AMBOS TOKENS
    // ----------------------------------------------------

    // 1. Definimos la URL del claim
    const CLAIM_URL = 'https://azor-calidad.netlify.app/roles';
    let userRoles = [];

    try {
        // INTENTO A: Leer del ID Token (más simple)
        const idTokenClaims = await auth0Client.getIdTokenClaims();
        if (idTokenClaims && idTokenClaims[CLAIM_URL] && idTokenClaims[CLAIM_URL].length > 0) {
            userRoles = idTokenClaims[CLAIM_URL];
        } else {
            // INTENTO B: Leer del Access Token (más robusto con API)
            const accessToken = await auth0Client.getTokenSilently(); 
            const parsedToken = parseJwt(accessToken); // Requiere la función parseJwt
            if (parsedToken && parsedToken[CLAIM_URL]) {
                userRoles = parsedToken[CLAIM_URL];
            }
        }
    } catch (error) {
        console.error("Error al obtener o decodificar tokens:", error);
    }

    console.log("Usuario autenticado. Roles encontrados:", userRoles); 

    // === LÓGICA DE BLOQUEO 1: USUARIO AUTENTICADO PERO SIN ROL ===
    const hasNoRole = userRoles.length === 0;

    if (isAuthenticated && hasNoRole) {
        console.log("Usuario autenticado pero sin rol. Redirigiendo a logout.");

        // Mostrar pantalla de login antes del logout
        if(protectedContent) protectedContent.style.display = 'none';
        if(loginScreen) loginScreen.style.display = 'block';

        // Forzamos el cierre de sesión para que el usuario no pueda continuar
        auth0Client.logout({
            logoutParams: {
                returnTo: window.location.origin
            }
        });
        return; // <--- SÚPER IMPORTANTE: Detiene la ejecución aquí.
    }
    // === FIN DE BLOQUEO 1 ===

    // === LÓGICA DE BLOQUEO 2: PÁGINAS CON RESTRICCIÓN DE ROL ESPECÍFICO ===
    if (requiredRoles.length > 0) {
        const hasRequiredRole = requiredRoles.some(r => userRoles.includes(r));
        if (!hasRequiredRole) {
            console.warn("Acceso denegado. No tiene los roles necesarios:", requiredRoles);
            
            // 🛑 Si el acceso es denegado, mostramos la pantalla de login antes de redirigir
            if(protectedContent) protectedContent.style.display = 'none';
            if(loginScreen) loginScreen.style.display = 'block';
            
            // Redirigimos a la página principal
            window.location.replace(window.location.origin); 

            return;
        }
    }
    // === FIN DE BLOQUEO 2 ===

    // ***************************************************************
    // 🏆 PUNTO FINAL DE ÉXITO: MOSTRAR CONTENIDO PROTEGIDO 🏆
    // Si llegamos aquí, el usuario está autenticado y tiene los roles.
    // ***************************************************************
    
    if(protectedContent) protectedContent.style.display = 'block'; 
    if(loginScreen) loginScreen.style.display = 'none';
    if(logoutButton) logoutButton.style.display = 'inline-block';

    // El resto de la lógica (visibilidad de enlaces) SOLO se aplica si el usuario pasa todos los filtros
    const isAdmin = userRoles.includes('admin');
    const isSuperMan = userRoles.includes('super_man');
    const isSuper = userRoles.includes('super');
    
    // --- Regla 1 y 2: KPIs y Dashboard Ajustes ---
    const canSeeKpisAndDashboard = isAdmin || isSuperMan || isSuper;
    
    if (kpisLink) {
        kpisLink.style.display = canSeeKpisAndDashboard ? 'block' : 'none';
    }
    
    if (dashboardAjustesLink) {
        dashboardAjustesLink.style.display = canSeeKpisAndDashboard ? 'block' : 'none';
    }

    // --- Regla 3: Admin Mantenimiento ---
    const canSeeAdminMantenimiento = isAdmin || isSuperMan;
    
    if (adminMantenimientoLink) {
        adminMantenimientoLink.style.display = canSeeAdminMantenimiento ? 'block' : 'none';
    }
};