import { Toaster } from "@/components/ui/toaster"
import { QueryClientProvider } from '@tanstack/react-query'
import { queryClientInstance } from '@/lib/query-client'
import { BrowserRouter as Router, Route, Routes, Navigate } from 'react-router-dom';
import PageNotFound from './lib/PageNotFound';
import { AuthProvider, useAuth } from '@/lib/AuthContext';
import UserNotRegisteredError from '@/components/UserNotRegisteredError';
import Login from './pages/Login';
import Register from './pages/Register';
import ForgotPassword from './pages/ForgotPassword';
import ResetPassword from './pages/ResetPassword';
import Home from './pages/Home';
import Comprar from './pages/Comprar';
import Games from './pages/Games';
import GiftCards from './pages/GiftCards';
import Admin from './pages/Admin';
import FreeFirePanel from './pages/FreeFirePanel';
import CompletarPago from './pages/CompletarPago';
import Creadores from './pages/Creadores';
import Canjear from './pages/Canjear';
import Servicios from './pages/Servicios';
import MisPedidos from './pages/MisPedidos';
import Perfil from './pages/Perfil';
import Documentacion from './pages/Documentacion';
import ProtectedRoute from '@/components/ProtectedRoute';
import Layout from './components/Layout';
// Add page imports here

const AuthenticatedApp = () => {
  const { isLoadingAuth, isLoadingPublicSettings, authError, navigateToLogin } = useAuth();

  if (isLoadingPublicSettings || isLoadingAuth) {
    return (
      <div className="fixed inset-0 flex items-center justify-center">
        <div className="w-8 h-8 border-4 border-muted border-t-foreground rounded-full animate-spin" />
      </div>
    );
  }

  if (authError) {
    if (authError.type === 'user_not_registered') {
      return <UserNotRegisteredError />;
    } else if (authError.type === 'auth_required') {
      navigateToLogin();
      return null;
    }
  }

  return (
    <Routes>
      <Route element={<Layout />}>
        <Route path="/" element={<Home />} />
        <Route path="/Games" element={<Games />} />
        <Route path="/GiftCards" element={<GiftCards />} />
        <Route path="/Servicios" element={<Servicios />} />
        <Route path="/comprar/:slug" element={<Comprar />} />
        {/* Pantalla de datos del pago: ruta propia, como el checkout del
            proveedor (el cliente no desliza para llegar a pagar). */}
        <Route path="/pagar/:slug" element={<Comprar />} />
        <Route path="/completar-pago/:orderId" element={<CompletarPago />} />
        <Route path="/creadores" element={<Creadores />} />
        <Route path="/canjear" element={<Canjear />} />
        <Route path="/mis-pedidos" element={<MisPedidos />} />
        <Route path="/Login" element={<Login />} />
        <Route path="/Register" element={<Register />} />
        <Route path="/forgot-password" element={<ForgotPassword />} />
        <Route path="/reset-password" element={<ResetPassword />} />
      </Route>
      <Route element={<ProtectedRoute unauthenticatedElement={<Navigate to="/Login" replace />} />}>
        {/* Documentacion de migracion: describe la arquitectura interna, los
            proveedores de pago y los nombres de variables de entorno. No es
            una pagina de clientes, asi que va dentro del area protegida. */}
        <Route path="/documentacion" element={<Documentacion />} />
        <Route path="/admin" element={<Admin />} />
        <Route path="/freefire" element={<FreeFirePanel />} />
        <Route path="/perfil" element={<Perfil />} />
      </Route>
      <Route path="*" element={<PageNotFound />} />
    </Routes>
  );
};

function App() {
  return (
    <AuthProvider>
      <QueryClientProvider client={queryClientInstance}>
        <Router>
          <AuthenticatedApp />
        </Router>
        <Toaster />
      </QueryClientProvider>
    </AuthProvider>
  )
}

export default App