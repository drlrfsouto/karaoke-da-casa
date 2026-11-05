import React from "react";
import ReactDOM from "react-dom/client";
import { BrowserRouter, Routes, Route } from "react-router-dom";
import { AuthProvider } from "./context/AuthContext";
import Home from "./pages/Home";
import RoomTV from "./pages/RoomTV";
import RoomMobile from "./pages/RoomMobile";
import Dashboard from "./pages/Dashboard";
import Login from "./pages/Login";
import RegisterHost from "./pages/RegisterHost";
import CompleteProfile from "./pages/CompleteProfile";
import GuestRegister from "./pages/GuestRegister";
import CreateRoom from "./pages/CreateRoom";
import TvLogin from "./pages/TvLogin";
import JoinRedirect from "./pages/JoinRedirect";
import "./index.css";

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <AuthProvider>
      <BrowserRouter>
        <Routes>
          <Route path="/" element={<Home />} />
          <Route path="/login" element={<Login />} />
          <Route path="/register" element={<RegisterHost />} />
          <Route path="/complete-profile" element={<CompleteProfile />} />
          <Route path="/guest-register" element={<GuestRegister />} />
          <Route path="/create-room" element={<CreateRoom />} />
          <Route path="/join/:code" element={<JoinRedirect />} />
          <Route path="/room/:code/tv" element={<RoomTV />} />
          <Route path="/room/:code/tv/login" element={<TvLogin />} />
          <Route path="/room/:code" element={<RoomMobile />} />
          <Route path="/admin" element={<Dashboard />} />
        </Routes>
      </BrowserRouter>
    </AuthProvider>
  </React.StrictMode>
);
