// *** CONSTANTES DE TU APP AZOR-CALIDAD-NETLIFY ***
const AUTH0_DOMAIN = "dev-8nfvmq7g3rifqdu4.us.auth0.com";
const AUTH0_CLIENT_ID = "pQcvfNTw848DR4DtRKKUN8nxcsquGkAo"; 
const AZOR_API_AUDIENCE = "https://azor-calidad.netlify.app"; 

let auth0Client = null;

// Función auxiliar para decodificar JWT
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
        return null;
    }
}

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

// MANEJO DE CALLBACK: Evita errores de estado al navegar o refrescar
const handleRedirectCallback = async () => {
    const query = window.location.search;
    const hasParams = query.includes("code=") && query.includes("state=");
    
    if (hasParams) {
        try {
            // Verificamos si ya hay sesión para no procesar un estado viejo
            const isAuthenticated = await auth0Client.isAuthenticated();
            if (!isAuthenticated) {
                await auth0Client.handleRedirectCallback();
            }
        } catch (err) {
            // Silenciamos el error de estado inválido ya que limpiamos la URL
            console.warn("Estado de Auth0 expirado o procesado previamente.");
        } finally {
            // Limpiamos la URL de parámetros siempre
            window.history.replaceState({}, document.title, window.location.pathname);
        }
    }
};

const login = async () => {
    await auth0Client.loginWithRedirect({
         authorizationParams: { audience: AZOR_API_AUDIENCE }
    });
};

const logout = () => {
    auth0Client.logout({
        logoutParams: { returnTo: window.location.origin }
    });
};

const initializeAuth = async (authRequired = false, requiredRoles = []) => {
    await configureClient();
    await handleRedirectCallback(); 
    await updateUI(authRequired, requiredRoles);
};

const updateUI = async (authRequired, requiredRoles) => {
    const isAuthenticated = await auth0Client.isAuthenticated();
    
    const protectedContent = document.getElementById('protected-content');
    const loginScreen = document.getElementById('login-screen');

    // Limpiamos estados previos para evitar el parpadeo
    if(protectedContent) protectedContent.style.display = 'none';
    if(loginScreen) loginScreen.style.display = 'none';

    if (!isAuthenticated) {
        if (authRequired) {
             await login(); 
             return; 
        }
        // Si no está autenticado, mostramos login
        if(loginScreen) loginScreen.style.display = 'block';
        return;
    }
    
    // Si llegamos aquí, ESTÁ autenticado. 
    // Ejecutamos validación de roles...
    const CLAIM_URL = 'https://azor-calidad.netlify.app/roles';
    let userRoles = [];
    try {
        const idTokenClaims = await auth0Client.getIdTokenClaims();
        userRoles = idTokenClaims?.[CLAIM_URL] || [];
    } catch (e) { console.error(e); }

    // Si tiene roles, mostramos el contenido protegido
    if (userRoles.length > 0) {
        if(protectedContent) protectedContent.style.display = 'block';
        
        // Lógica de visibilidad de botones/links
        actualizarVisibilidadBotones(userRoles);
    } else {
        // Si no tiene roles, lo sacamos
        logout();
    }
};

// Función de apoyo para limpiar el código principal
function actualizarVisibilidadBotones(userRoles) {
    const isAdmin = userRoles.includes('admin') || userRoles.includes('super_man');
    const isUser = userRoles.includes('super') || isAdmin;

    const kpis = document.getElementById('link-kpis');
    const dash = document.getElementById('link-dashboard-ajustes');
    const admin = document.getElementById('link-admin-mantenimiento');
    const logoutBtn = document.getElementById('logout-button');

    if (kpis) kpis.style.display = isUser ? 'block' : 'none';
    if (dash) dash.style.display = isUser ? 'block' : 'none';
    if (admin) admin.style.display = isAdmin ? 'block' : 'none';
    if (logoutBtn) logoutBtn.style.display = 'inline-block';
}