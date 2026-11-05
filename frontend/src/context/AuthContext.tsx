import React, {
  createContext,
  useContext,
  useState,
  useEffect,
  useCallback,
} from "react";
import { API_BASE } from "../api";

const TOKEN_KEY = "karaokeando_token";

// Types
export interface User {
  id: string;
  name: string;
  email: string;
  phone?: string;
  city?: string;
  birthDate?: string;
  gender?: string;
  canHost: boolean;
  isComplete: boolean;
}

interface AuthContextType {
  user: User | null;
  token: string | null;
  loading: boolean;
  login: (
    email: string,
    password: string
  ) => Promise<{ success: boolean; error?: string }>;
  registerGuest: (
    name: string,
    email: string,
    phone: string
  ) => Promise<{ success: boolean; error?: string; requiresLogin?: boolean }>;
  registerHost: (
    data: RegisterHostData
  ) => Promise<{ success: boolean; error?: string }>;
  completeRegistration: (
    data: CompleteRegistrationData
  ) => Promise<{ success: boolean; error?: string }>;
  logout: () => void;
  refreshUser: () => Promise<void>;
}

interface RegisterHostData {
  name: string;
  email: string;
  phone: string;
  password: string;
  city: string;
  birthDate: string;
  gender: string;
}

interface CompleteRegistrationData {
  phone: string;
  password: string;
  city: string;
  birthDate: string;
  gender: string;
}

const AuthContext = createContext<AuthContextType | null>(null);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [token, setToken] = useState<string | null>(() => {
    return localStorage.getItem(TOKEN_KEY);
  });
  const [loading, setLoading] = useState(true);

  // Fetch user data from token
  const refreshUser = useCallback(async () => {
    const storedToken = localStorage.getItem(TOKEN_KEY);
    if (!storedToken) {
      setUser(null);
      setLoading(false);
      return;
    }

    try {
      const res = await fetch(`${API_BASE}/api/auth/me`, {
        headers: { Authorization: `Bearer ${storedToken}` },
      });

      if (res.ok) {
        const data = await res.json();
        setUser(data.user);
        setToken(storedToken);
      } else {
        // Token invalid
        localStorage.removeItem(TOKEN_KEY);
        setToken(null);
        setUser(null);
      }
    } catch {
      // Network error, keep token but clear user
      setUser(null);
    } finally {
      setLoading(false);
    }
  }, []);

  // Load user on mount
  useEffect(() => {
    refreshUser();
  }, [refreshUser]);

  // Login
  const login = async (email: string, password: string) => {
    try {
      const res = await fetch(`${API_BASE}/api/auth/login`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password }),
      });

      const data = await res.json();

      if (res.ok) {
        localStorage.setItem(TOKEN_KEY, data.token);
        setToken(data.token);
        setUser(data.user);
        return { success: true };
      } else {
        return { success: false, error: data.message || "Erro ao fazer login" };
      }
    } catch {
      return { success: false, error: "Erro de conexão" };
    }
  };

  // Register as guest (name + email + phone)
  const registerGuest = async (name: string, email: string, phone: string) => {
    try {
      const res = await fetch(`${API_BASE}/api/auth/register-guest`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, email, phone }),
      });

      const data = await res.json();

      if (res.ok) {
        localStorage.setItem(TOKEN_KEY, data.token);
        setToken(data.token);
        setUser(data.user);
        return { success: true };
      } else {
        const errorMsg =
          data.details?.[0]?.message || data.message || "Erro ao registrar";
        return {
          success: false,
          error: errorMsg,
          requiresLogin: data.requiresLogin || false,
        };
      }
    } catch {
      return { success: false, error: "Erro de conexão" };
    }
  };

  // Complete registration (become host)
  const completeRegistration = async (data: CompleteRegistrationData) => {
    if (!token) {
      return { success: false, error: "Não autenticado" };
    }

    try {
      const res = await fetch(`${API_BASE}/api/auth/complete-registration`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify(data),
      });

      const resData = await res.json();

      if (res.ok) {
        localStorage.setItem(TOKEN_KEY, resData.token);
        setToken(resData.token);
        setUser(resData.user);
        return { success: true };
      } else {
        const errorMsg =
          resData.details?.[0]?.message ||
          resData.message ||
          "Erro ao completar cadastro";
        return { success: false, error: errorMsg };
      }
    } catch {
      return { success: false, error: "Erro de conexão" };
    }
  };

  // Register as host (full registration in one step)
  const registerHost = async (data: RegisterHostData) => {
    try {
      const res = await fetch(`${API_BASE}/api/auth/register-host`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data),
      });

      const resData = await res.json();

      if (res.ok) {
        localStorage.setItem(TOKEN_KEY, resData.token);
        setToken(resData.token);
        setUser(resData.user);
        return { success: true };
      } else {
        const errorMsg = resData.message || "Erro ao criar conta";
        return { success: false, error: errorMsg };
      }
    } catch {
      return { success: false, error: "Erro de conexão" };
    }
  };

  // Logout
  const logout = () => {
    localStorage.removeItem(TOKEN_KEY);
    setToken(null);
    setUser(null);
  };

  return (
    <AuthContext.Provider
      value={{
        user,
        token,
        loading,
        login,
        registerGuest,
        registerHost,
        completeRegistration,
        logout,
        refreshUser,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error("useAuth must be used within AuthProvider");
  }
  return context;
}

// Helper to get token for API calls
export function getToken(): string | null {
  return localStorage.getItem(TOKEN_KEY);
}
