
-- =========================
-- SEED DATA
-- =========================

-- Roles
INSERT INTO roles (id, name) VALUES
('r1', 'admin'),
('r2', 'member');

-- Users
INSERT INTO users (id, email, password_hash, name) VALUES
('u1', 'admin@testiny.ai', 'hashed_pw', 'Admin User'),
('u2', 'qa@testiny.ai', 'hashed_pw', 'QA User');

-- Project
INSERT INTO projects (id, name, description, created_by) VALUES
('p1', 'E-Commerce System', 'End-to-end product testing', 'u1');

-- Project Members
INSERT INTO project_members (id, project_id, user_id, role_id) VALUES
('pm1', 'p1', 'u1', 'r1'),
('pm2', 'p1', 'u2', 'r2');

-- App Types
INSERT INTO app_types (id, project_id, name, type, is_unified) VALUES
('a1', 'p1', 'Web App', 'web', 0),
('a2', 'p1', 'API Layer', 'api', 0),
('a3', 'p1', 'Android App', 'android', 0),
('a4', 'p1', 'iOS App', 'ios', 0),
('a5', 'p1', 'Unified Flows', 'unified', 1);

-- Requirements
INSERT INTO requirements (id, project_id, title, description) VALUES
('req1', 'p1', 'User Login', 'User should login successfully'),
('req2', 'p1', 'Place Order', 'User should place order');

-- Feedback
INSERT INTO feedback (id, user_id, title, message, status) VALUES
('fb1', 'u1', 'Bulk import flow', 'Would love a CSV import for requirements and test cases.', 'open'),
('fb2', 'u2', 'Execution notes', 'A dedicated notes area during execution would help triage faster.', 'reviewed');

-- Test Suites (Web)
INSERT INTO test_suites (id, app_type_id, name) VALUES
('ts1', 'a1', 'Authentication'),
('ts2', 'a5', 'Unified Checkout');

-- Test Cases
INSERT INTO test_cases (id, app_type_id, suite_id, title, description, requirement_id) VALUES
('tc1', 'a1', 'ts1', 'Login with valid credentials', 'Verify login works', 'req1'),
('tc2', 'a5', 'ts2', 'Place order flow', 'Verify checkout flow', 'req2');

-- Test Steps
INSERT INTO test_steps (id, test_case_id, step_order, action, expected_result) VALUES
('s1', 'tc1', 1, 'Open app', 'App loads'),
('s2', 'tc1', 2, 'Enter credentials', 'Credentials accepted'),
('s3', 'tc1', 3, 'Submit login', 'User logged in'),

('s4', 'tc2', 1, 'Add item to cart', 'Item added'),
('s5', 'tc2', 2, 'Proceed to checkout', 'Checkout page opens'),
('s6', 'tc2', 3, 'Confirm order', 'Order placed');

-- Execution
INSERT INTO executions (id, project_id, name, trigger, status, created_by, started_at) VALUES
('e1', 'p1', 'Regression Run', 'manual', 'running', 'u1', CURRENT_TIMESTAMP);

-- Execution Results
INSERT INTO execution_results (id, execution_id, test_case_id, app_type_id, status, duration_ms, executed_by) VALUES
('er1', 'e1', 'tc1', 'a1', 'passed', 1200, 'u2'),
('er2', 'e1', 'tc2', 'a5', 'failed', 2500, 'u2');
