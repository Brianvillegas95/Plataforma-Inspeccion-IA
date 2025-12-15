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
const initializeAuth = async (authRequired = false, requiredRoles = [], onAuthSuccess = null) => {
    console.log(`[AUTH] Inicializando autenticación. Requerido: ${authRequired}, Roles necesarios: ${requiredRoles.join(', ') || 'Ninguno'}`);
    await configureClient();
    await handleRedirectCallback();
    await updateUI(authRequired, requiredRoles, onAuthSuccess); // Pasa los parámetros
};

// Actualiza la interfaz para mostrar/ocultar contenido y aplicar restricciones por rol
const updateUI = async (authRequired, requiredRoles, onAuthSuccess) => {
    const isAuthenticated = await auth0Client.isAuthenticated();
    
    const mainAppContainer = document.getElementById('app-container');
    const protectedContent = document.getElementById('protected-content');
    const loginScreen = document.getElementById('login-screen');
    const logoutButton = document.getElementById('logout-button');
    
    const kpisLink = document.getElementById('link-kpis');
    const dashboardAjustesLink = document.getElementById('link-dashboard-ajustes');
    const adminMantenimientoLink = document.getElementById('link-admin-mantenimiento');

    // === LÓGICA DE BLOQUEO DE PÁGINAS PROTEGIDAS (NO AUTENTICADO) ===
    if (!isAuthenticated) {
        if (authRequired) {
             console.log("[AUTH] Página protegida. Usuario no autenticado. Redirigiendo a login.");
             await login(); 
             return; 
        }

        if(protectedContent) protectedContent.style.display = 'none';
        if(loginScreen) loginScreen.style.display = 'block';
        if(logoutButton) logoutButton.style.display = 'none';
        
        hideAllRestrictedLinks(kpisLink, dashboardAjustesLink, adminMantenimientoLink);
        return;
    }
    
    // Si está autenticado...
    console.log("[AUTH] Usuario autenticado. Procediendo con la verificación de roles.");
    if(protectedContent) protectedContent.style.display = 'block';
    if(loginScreen) loginScreen.style.display = 'none';
    if(logoutButton) logoutButton.style.display = 'inline-block';

    // ----------------------------------------------------
    // LÓGICA DE RESTRICCIÓN POR ROLES: LEYENDO AMBOS TOKENS
    // ----------------------------------------------------

    const CLAIM_URL = 'https://azor-calidad.netlify.app/roles';
    let userRoles = [];
    let tokenRetrievalFailed = false; // <-- BANDERA PARA EVITAR EL BUCLE

    try {
        const idTokenClaims = await auth0Client.getIdTokenClaims();
        console.log("[AUTH] Intentando obtener roles desde ID Token.");
        
        if (idTokenClaims && idTokenClaims[CLAIM_URL] && idTokenClaims[CLAIM_URL].length > 0) {
            userRoles = idTokenClaims[CLAIM_URL];
            console.log(`[AUTH] Roles encontrados en ID Token: ${userRoles.join(', ')}`);
        } else {
            console.log("[AUTH] Roles no encontrados en ID Token. Intentando getTokenSilently.");
            const accessToken = await auth0Client.getTokenSilently(); 
            const parsedToken = parseJwt(accessToken); 
            
            if (parsedToken && parsedToken[CLAIM_URL]) {
                userRoles = parsedToken[CLAIM_URL];
                console.log(`[AUTH] Roles encontrados en Access Token: ${userRoles.join(', ')}`);
            } else {
                console.log("[AUTH] Roles no encontrados ni en ID Token ni en Access Token.");
            }
        }
    } catch (error) {
        // MENSAJE CLAVE DE FALLO
        console.error("[AUTH] ALERTA CRÍTICA: Falló la obtención de tokens silenciosa (getTokenSilently). Esto puede causar una redirección por rol fallida.", error);
        tokenRetrievalFailed = true; // Establecemos la bandera
    }

    console.log("Usuario autenticado. Roles finales:", userRoles); 

    // === LÓGICA DE BLOQUEO 1: USUARIO AUTENTICADO PERO SIN ROL ===
    const hasNoRole = userRoles.length === 0;

    // ⚠️ CORRECCIÓN CLAVE: Solo hacemos logout si:
    // 1. Está autenticado.
    // 2. NO tiene roles (hasNoRole=true).
    // 3. El token se cargó exitosamente (!tokenRetrievalFailed).
    // 4. LA PÁGINA ES RESTRINGIDA (requiredRoles.length > 0).
    if (isAuthenticated && hasNoRole && !tokenRetrievalFailed && requiredRoles.length > 0) { 
        console.log("[AUTH] Bloqueo 1 activado. Usuario sin rol, pero la página requiere uno. Redirigiendo a logout.");

        if(protectedContent) protectedContent.style.display = 'none';
        if(loginScreen) loginScreen.style.display = 'block';

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
        console.log(`[AUTH] La página requiere roles: ${requiredRoles.join(', ')}`);
        const hasRequiredRole = requiredRoles.some(r => userRoles.includes(r));
        
        if (!hasRequiredRole) {
            // Esto se activa si userRoles=[] debido a un fallo silencioso (tokenRetrievalFailed=true)
            // o si el usuario simplemente no tiene el rol necesario.
            console.warn("[AUTH] Acceso denegado. El usuario no tiene el rol requerido o Fallo en Token. Redirigiendo a Index.");
            window.location.replace(window.location.origin); 
            return;
        }
        console.log("[AUTH] Verificación de rol exitosa. Acceso concedido.");
    }
    // === FIN DE BLOQUEO 2 ===

    // El resto de la lógica (visibilidad de enlaces en index.html)
    const isAdmin = userRoles.includes('admin');
    const isSuperMan = userRoles.includes('super_man');
    const isSuper = userRoles.includes('super');
    
    const canSeeKpisAndDashboard = isAdmin || isSuperMan || isSuper;
    
    if (kpisLink) kpisLink.style.display = canSeeKpisAndDashboard ? 'block' : 'none';
    if (dashboardAjustesLink) dashboardAjustesLink.style.display = canSeeKpisAndDashboard ? 'block' : 'none';

    const canSeeAdminMantenimiento = isAdmin || isSuperMan;
    if (adminMantenimientoLink) adminMantenimientoLink.style.display = canSeeAdminMantenimiento ? 'block' : 'none';
    
    // Si pasó todas las verificaciones, mostramos la aplicación y ejecutamos el callback.
    if (mainAppContainer) {
        mainAppContainer.style.display = 'block';
    }

    if (onAuthSuccess && typeof onAuthSuccess === 'function') {
        onAuthSuccess();
    }
};

// Función de inicialización para la página principal (index.html)
window.onload = () => {
    initializeAuth(false, [], null); 
};