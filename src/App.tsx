import { useState, useEffect, createContext, useContext, ReactNode, useCallback, useRef } from 'react';
import { HashRouter, Routes, Route, Link, useLocation, useNavigate, useParams } from 'react-router-dom';
import {
  ShoppingBag, Menu, X, Search, User as UserIcon, LogOut, Package,
  Shield, Star, Truck, RotateCcw, Award, Zap, ArrowRight, Mail, Phone,
  MapPin, Plus, Minus, Trash2, Lock, Loader2, CheckCircle, CreditCard,
  FolderTree, Edit2, Users as UsersIcon, Settings, LayoutDashboard,
  ShoppingCart, AlertTriangle, ToggleLeft, ToggleRight, Eye,
  ChevronDown, ChevronRight, Save, ArrowLeft, DollarSign, Upload, ImageIcon,
  Globe, Clock, Send, Headphones, ChevronLeft, Sparkles, TrendingUp,
  FileText, PenLine, Calendar, Tag, BookOpen, EyeOff, ChevronUp,
} from 'lucide-react';