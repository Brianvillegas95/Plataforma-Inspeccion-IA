// *** CONSTANTES DE TU APP AZOR-CALIDAD-NETLIFY ***
const AUTH0_DOMAIN = "dev-8nfvmq7g3rifqdu4.us.auth0.com";
const AUTH0_CLIENT_ID = "pQcvfNTw848DR4DtRKKUN8nxcsquGkAo"; 
const AZOR_API_AUDIENCE = "https://azor-calidad.netlify.app"; // Identificador de tu API

let auth0Client = null;

// NUEVA FUNCIÓN: Controla la visibilidad final de toda la aplicación
const showApp = () => {
    document.body.style.visibility = 'visible';
    document.body.style.opacity = '1';
};

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
    
    // 🛑 MODIFICACIÓN CRÍTICA PARA ESTABILIDAD DE AUTH0 🛑
    if (query.includes("code=") && query.includes("state=")) {
        try {
            await auth0Client.handleRedirectCallback();
            window.history.replaceState({}, document.title, window.location.pathname);
        } catch (err) {
            console.error("Error al procesar el callback de Auth0:", err);
            // 💡 CRUCIAL: Limpiar la URL si falla ("Invalid state") para evitar que el error se repita y cause inestabilidad.
            window.history.replaceState({}, document.title, window.location.pathname); 
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

    // Ocultar los contenedores al inicio (trabajando con el CSS del body).
    if(protectedContent) protectedContent.style.display = 'none';
    if(loginScreen) loginScreen.style.display = 'none';

    // === LÓGICA DE BLOQUEO DE PÁGINAS PROTEGIDAS (NO AUTENTICADO) ===
    if (!isAuthenticated) {
        if (authRequired) {
             console.log("Página protegida. Usuario no autenticado. Redirigiendo a login.");
             await login(); 
             return; 
        }

        // Si la página NO requiere autenticación (index.html):
        if(loginScreen) loginScreen.style.display = 'block';
        if(logoutButton) logoutButton.style.display = 'none';
        
        hideAllRestrictedLinks(kpisLink, dashboardAjustesLink, adminMantenimientoLink);
        
        // 🏆 Muestra la aplicación completa (solo pantalla de login)
        showApp();
        return;
    }
    
    // Si está autenticado...
    
    // ----------------------------------------------------
    // LÓGICA DE RESTRICCIÓN POR ROLES: LEYENDO AMBOS TOKENS
    // ----------------------------------------------------

    const CLAIM_URL = 'https://azor-calidad.netlify.app/roles';
    let userRoles = [];

    try {
        const idTokenClaims = await auth0Client.getIdTokenClaims();
        if (idTokenClaims && idTokenClaims[CLAIM_URL] && idTokenClaims[CLAIM_URL].length > 0) {
            userRoles = idTokenClaims[CLAIM_URL];
        } else {
            const accessToken = await auth0Client.getTokenSilently(); 
            const parsedToken = parseJwt(accessToken);
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

        if(protectedContent) protectedContent.style.display = 'none';
        if(loginScreen) loginScreen.style.display = 'block';
        
        // Muestra la pantalla de login un momento antes del logout
        showApp();

        auth0Client.logout({
            logoutParams: {
                returnTo: window.location.origin
            }
        });
        return; 
    }
    // === FIN DE BLOQUEO 1 ===

    // === LÓGICA DE BLOQUEO 2: PÁGINAS CON RESTRICCIÓN DE ROL ESPECÍFICO ===
    if (requiredRoles.length > 0) {
        const hasRequiredRole = requiredRoles.some(r => userRoles.includes(r));
        if (!hasRequiredRole) {
            console.warn("Acceso denegado. No tiene los roles necesarios:", requiredRoles);
            
            if(protectedContent) protectedContent.style.display = 'none';
            if(loginScreen) loginScreen.style.display = 'block';
            
            // Muestra la pantalla de login un momento antes de redirigir
            showApp();
            
            window.location.replace(window.location.origin); 
            return;
        }
    }
    // === FIN DE BLOQUEO 2 ===

    // ***************************************************************
    // 🏆 PUNTO FINAL DE ÉXITO: MOSTRAR CONTENIDO PROTEGIDO 🏆
    // ***************************************************************
    
    if(protectedContent) protectedContent.style.display = 'block'; 
    if(loginScreen) loginScreen.style.display = 'none';
    if(logoutButton) logoutButton.style.display = 'inline-block';

    // ... (Lógica de visibilidad de enlaces por rol)
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
    
    // 🏆 Muestra la aplicación completa (solo contenido protegido)
    showApp();
};