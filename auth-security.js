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
    
    // Solo actuamos si la URL trae parámetros de Auth0
    if (query.includes("code=") && query.includes("state=")) {
        try {
            await auth0Client.handleRedirectCallback();
            console.log("Callback de Auth0 procesado con éxito.");
        } catch (err) {
            // Se captura el "Invalid state" para que no rompa la ejecución
            console.warn("Aviso: El estado de la sesión anterior no era válido o ya fue procesado.");
        } finally {
            // 🛑 SIEMPRE limpiamos la URL para evitar que el error persista al recargar 🛑
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
    
    // Elementos de menú que controlaremos por ID
    const kpisLink = document.getElementById('link-kpis');
    const dashboardAjustesLink = document.getElementById('link-dashboard-ajustes');
    const adminMantenimientoLink = document.getElementById('link-admin-mantenimiento');

    // === LÓGICA DE BLOQUEO DE PÁGINAS PROTEGIDAS (NO AUTENTICADO) ===
    if (!isAuthenticated) {
        if (authRequired) {
             console.log("Página protegida. Usuario no autenticado. Redirigiendo a login.");
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
    if(protectedContent) protectedContent.style.display = 'block';
    if(loginScreen) loginScreen.style.display = 'none';
    if(logoutButton) logoutButton.style.display = 'inline-block';

    // LÓGICA DE RESTRICCIÓN POR ROLES
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

    // === BLOQUEO 1: SIN ROL ===
    const hasNoRole = userRoles.length === 0;
    if (isAuthenticated && hasNoRole) {
        auth0Client.logout({
            logoutParams: { returnTo: window.location.origin }
        });
        return;
    }

    // === BLOQUEO 2: ROL ESPECÍFICO ===
    if (requiredRoles.length > 0) {
        const hasRequiredRole = requiredRoles.some(r => userRoles.includes(r));
        if (!hasRequiredRole) {
            window.location.replace(window.location.origin); 
            return;
        }
    }

    // Visibilidad de enlaces
    const isAdmin = userRoles.includes('admin');
    const isSuperMan = userRoles.includes('super_man');
    const isSuper = userRoles.includes('super');
    
    const canSeeKpisAndDashboard = isAdmin || isSuperMan || isSuper;
    
    if (kpisLink) kpisLink.style.display = canSeeKpisAndDashboard ? 'block' : 'none';
    if (dashboardAjustesLink) dashboardAjustesLink.style.display = canSeeKpisAndDashboard ? 'block' : 'none';

    const canSeeAdminMantenimiento = isAdmin || isSuperMan;
    if (adminMantenimientoLink) adminMantenimientoLink.style.display = canSeeAdminMantenimiento ? 'block' : 'none';
};