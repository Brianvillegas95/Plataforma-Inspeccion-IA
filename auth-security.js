// *** CONSTANTES DE TU APP AZOR-CALIDAD-NETLIFY ***
const AUTH0_DOMAIN = "dev-8nfvmq7g3rifqdu4.us.auth0.com";
const AUTH0_CLIENT_ID = "pQcvfNTw848DR4DtRKKUN8nxcsquGkAo"; 
const AZOR_API_AUDIENCE = "https://azor-calidad.netlify.app"; 

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
            audience: AZOR_API_AUDIENCE, 
            scope: 'openid profile email' 
        }
    });
};

// Maneja el regreso desde la página de login (CORREGIDO: Manejo de State e historial)
const handleRedirectCallback = async () => {
    const query = window.location.search;
    if (query.includes("code=") && query.includes("state=")) {
        try {
            await auth0Client.handleRedirectCallback();
            // Limpiamos los parámetros de la URL inmediatamente después del éxito
            window.history.replaceState({}, document.title, window.location.pathname);
        } catch (err) {
            console.error("Error al procesar el callback de Auth0 o estado inválido:", err);
            // Limpiamos la URL incluso si falla para evitar que el error persista al recargar
            window.history.replaceState({}, document.title, window.location.pathname);
        }
    }
};

const login = async () => {
    await auth0Client.loginWithRedirect({
         authorizationParams: {
            audience: AZOR_API_AUDIENCE 
         }
    });
};

const logout = () => {
    auth0Client.logout({
        logoutParams: {
            returnTo: window.location.origin
        }
    });
};

const hideAllRestrictedLinks = (kpis, dashboard, admin) => {
    if (kpis) kpis.style.display = 'none';
    if (dashboard) dashboard.style.display = 'none';
    if (admin) admin.style.display = 'none';
};

const initializeAuth = async (authRequired = false, requiredRoles = []) => {
    await configureClient();
    await handleRedirectCallback();
    await updateUI(authRequired, requiredRoles);
};

// Actualiza la interfaz (OPTIMIZADO: Flujo lógico para evitar parpadeos)
const updateUI = async (authRequired, requiredRoles) => {
    const isAuthenticated = await auth0Client.isAuthenticated();
    
    const protectedContent = document.getElementById('protected-content');
    const loginScreen = document.getElementById('login-screen');
    const logoutButton = document.getElementById('logout-button');
    
    const kpisLink = document.getElementById('link-kpis');
    const dashboardAjustesLink = document.getElementById('link-dashboard-ajustes');
    const adminMantenimientoLink = document.getElementById('link-admin-mantenimiento');

    // === CASO 1: USUARIO NO AUTENTICADO ===
    if (!isAuthenticated) {
        if (authRequired) {
             console.log("Página protegida. Redirigiendo a login.");
             await login(); 
             return; 
        }

        // Si estamos en index y no hay sesión:
        if(protectedContent) protectedContent.style.display = 'none';
        if(loginScreen) loginScreen.style.display = 'block';
        if(logoutButton) logoutButton.style.display = 'none';
        hideAllRestrictedLinks(kpisLink, dashboardAjustesLink, adminMantenimientoLink);
        return;
    }
    
    // === CASO 2: USUARIO AUTENTICADO, VALIDAR ROLES ===
    const CLAIM_URL = 'https://azor-calidad.netlify.app/roles';
    let userRoles = [];

    try {
        const idTokenClaims = await auth0Client.getIdTokenClaims();
        if (idTokenClaims && idTokenClaims[CLAIM_URL]) {
            userRoles = idTokenClaims[CLAIM_URL];
        } else {
            const accessToken = await auth0Client.getTokenSilently(); 
            const parsedToken = parseJwt(accessToken);
            if (parsedToken && parsedToken[CLAIM_URL]) {
                userRoles = parsedToken[CLAIM_URL];
            }
        }
    } catch (error) {
        console.error("Error al obtener tokens:", error);
    }

    // Bloqueo 1: Autenticado pero sin ningún rol asignado
    if (userRoles.length === 0) {
        console.log("Sin roles. Cerrando sesión.");
        logout();
        return; 
    }

    // Bloqueo 2: Verificación de roles específicos para la página actual
    if (requiredRoles.length > 0) {
        const hasRequiredRole = requiredRoles.some(r => userRoles.includes(r));
        if (!hasRequiredRole) {
            window.location.replace(window.location.origin); 
            return;
        }
    }

    // === PUNTO DE ÉXITO: MOSTRAR INTERFAZ ===
    if(loginScreen) loginScreen.style.display = 'none';
    if(protectedContent) protectedContent.style.display = 'block'; 
    if(logoutButton) logoutButton.style.display = 'inline-block';

    // Lógica de visibilidad de menú según el rol
    const isAdmin = userRoles.includes('admin');
    const isSuperMan = userRoles.includes('super_man');
    const isSuper = userRoles.includes('super');
    
    const canSeeKpisAndDashboard = isAdmin || isSuperMan || isSuper;
    if (kpisLink) kpisLink.style.display = canSeeKpisAndDashboard ? 'block' : 'none';
    if (dashboardAjustesLink) dashboardAjustesLink.style.display = canSeeKpisAndDashboard ? 'block' : 'none';

    const canSeeAdminMantenimiento = isAdmin || isSuperMan;
    if (adminMantenimientoLink) adminMantenimientoLink.style.display = canSeeAdminMantenimiento ? 'block' : 'none';
};