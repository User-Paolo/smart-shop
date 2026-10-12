export type Role = 'customer' | 'admin';
export type OrderStatus = 'pending' | 'shipped' | 'delivered' | 'cancelled';
export type RiskLevel = 'high' | 'medium' | 'low';
export type JobState = 'never_run' | 'queued' | 'running' | 'done' | 'failed' | 'unknown';

export interface User {
  id: number;
  name: string;
  email: string;
  role: Role;
  created_at: string;
}

export interface AuthResponse {
  user: User;
  token: string;
  csrf_token: string;
  expires_in: number;
}

export interface Category {
  id: number;
  name: string;
}

export interface Product {
  id: number;
  sku: string;
  name: string;
  description: string | null;
  price: number;
  stock: number;
  is_active: boolean;
  category_id: number;
  category: string;
  created_at: string;
  updated_at: string;
}

export interface Page<T> {
  items: T[];
  page: number;
  per_page: number;
  total: number;
  pages: number;
}

export type ProductSort = 'name' | 'price_asc' | 'price_desc' | 'newest';

export interface ProductQuery {
  search?: string;
  category_id?: number;
  min_price?: number;
  max_price?: number;
  in_stock?: boolean;
  sort?: ProductSort;
  page?: number;
  per_page?: number;
}

export interface CartItem {
  product_id: number;
  name: string;
  sku: string;
  unit_price: number;
  quantity: number;
  stock: number;
  available: boolean;
  line_total: number;
}

export interface Cart {
  items: CartItem[];
  total: number;
  count: number;
}

export interface OrderSummary {
  id: number;
  user_id: number;
  customer: string;
  email: string;
  status: OrderStatus;
  created_at: string;
  updated_at: string;
  total: number;
  item_count: number;
}

export interface OrderPage {
  orders: OrderSummary[];
  page: number;
  pages: number;
  total: number;
}

export interface OrderLine {
  product_id: number;
  name: string;
  sku: string;
  quantity: number;
  unit_price: number;
  line_total: number;
}

export interface OrderDetail extends Omit<OrderSummary, 'item_count'> {
  items: OrderLine[];
}

export interface ForecastPoint {
  date: string;
  predicted: number;
}

export interface SalesPoint {
  date: string;
  units: number;
}

export interface ForecastProduct {
  model: string;
  product_id: number;
  sku: string;
  name: string;
  category: string;
  stock: number;
  predicted_7d: number;
  coverage_days: number | null;
  risk: RiskLevel;
  suggested_restock: number;
  daily: ForecastPoint[];
}

export interface ForecastJob {
  state: JobState;
  message?: string;
  started_at?: string;
  finished_at?: string;
  products?: number;
  rows_written?: number;
  mean_holdout_mae?: number | null;
  mean_baseline_mae?: number | null;
  skill_vs_baseline?: number | null;
  generated_at?: string;
}

export interface ForecastSummary {
  generated_at: string | null;
  model: string | null;
  products: ForecastProduct[];
  job: ForecastJob;
}

// Same rules as Order::TRANSITIONS in PHP
export const ORDER_TRANSITIONS: Readonly<Record<OrderStatus, readonly OrderStatus[]>> = {
  pending: ['shipped', 'cancelled'],
  shipped: ['delivered'],
  delivered: [],
  cancelled: [],
};
