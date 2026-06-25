export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[];

export interface Database {
  public: {
    Tables: {
      organizations: {
        Row: {
          id: string;
          name: string;
          slug: string;
          created_at: string;
          updated_at: string;
          owner_id: string;
          logo_url: string | null;
          // White-label terminology: what this org calls the sub-goal layer
          // under a Business Goal. Defaults to "Product Goal" but a reseller
          // selling this under their own brand may call it "Initiative",
          // "Workstream", "OKR", etc. — every place that label shows up in
          // the UI reads from here instead of a hardcoded string.
          product_goal_label: string;
        };
        Insert: {
          id?: string;
          name: string;
          slug: string;
          created_at?: string;
          updated_at?: string;
          owner_id: string;
          logo_url?: string | null;
          product_goal_label?: string;
        };
        Update: {
          id?: string;
          name?: string;
          slug?: string;
          updated_at?: string;
          logo_url?: string | null;
          product_goal_label?: string;
        };
      };
      organization_members: {
        Row: {
          id: string;
          organization_id: string;
          user_id: string;
          role: "owner" | "admin" | "member" | "viewer";
          created_at: string;
        };
        Insert: {
          id?: string;
          organization_id: string;
          user_id: string;
          role?: "owner" | "admin" | "member" | "viewer";
          created_at?: string;
        };
        Update: {
          role?: "owner" | "admin" | "member" | "viewer";
        };
      };
      profiles: {
        Row: {
          id: string;
          email: string;
          full_name: string | null;
          avatar_url: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id: string;
          email: string;
          full_name?: string | null;
          avatar_url?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          full_name?: string | null;
          avatar_url?: string | null;
          updated_at?: string;
        };
      };
      metrics: {
        Row: {
          id: string;
          organization_id: string;
          name: string;
          description: string | null;
          event_name: string | null;
          denominator_event_name: string | null;
          within_hours: number | null;
          rate_as_percentage: boolean;
          // Migration 034 — when set (e.g. "policy_id"), the numerator and
          // denominator events for this KPI are matched by that property's
          // value instead of by same-person-in-order. Null keeps the
          // existing per-user heuristic.
          match_key_property: string | null;
          aggregation: "count" | "unique_users" | "unique_sessions";
          business_goal_id: string | null;
          feature_metric_id: string | null;
          target: string | null;
          target_value: number | null;
          kind: "metric" | "kpi" | "guardrail";
          // Alternative to event_name for KPIs with no tracked source — read
          // the current month's value out of a connected sheet row instead.
          // See migration 029. All three null = "tracked event" mode.
          source_report_id: string | null;
          source_label_column: string | null;
          source_row_value: string | null;
          created_by: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          organization_id: string;
          name: string;
          description?: string | null;
          event_name?: string | null;
          denominator_event_name?: string | null;
          within_hours?: number | null;
          rate_as_percentage?: boolean;
          match_key_property?: string | null;
          aggregation?: "count" | "unique_users" | "unique_sessions";
          business_goal_id?: string | null;
          feature_metric_id?: string | null;
          target?: string | null;
          target_value?: number | null;
          kind?: "metric" | "kpi" | "guardrail";
          source_report_id?: string | null;
          source_label_column?: string | null;
          source_row_value?: string | null;
          created_by?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          name?: string;
          description?: string | null;
          event_name?: string | null;
          denominator_event_name?: string | null;
          within_hours?: number | null;
          rate_as_percentage?: boolean;
          match_key_property?: string | null;
          aggregation?: "count" | "unique_users" | "unique_sessions";
          business_goal_id?: string | null;
          feature_metric_id?: string | null;
          target?: string | null;
          target_value?: number | null;
          kind?: "metric" | "kpi" | "guardrail";
          source_report_id?: string | null;
          source_label_column?: string | null;
          source_row_value?: string | null;
          updated_at?: string;
        };
      };
      funnels: {
        Row: {
          id: string;
          organization_id: string;
          name: string;
          description: string | null;
          steps: { event_name: string }[];
          // How many days back computeFunnel looks when sequencing users
          // through the steps. Used to be hardcoded to 30 everywhere, which
          // silently undercounts conversions on longer sales cycles (e.g. a
          // user who signs up week 1 and completes a purchase week 6).
          // Per-funnel and adjustable from the funnel card, not locked in
          // at creation.
          lookback_days: number;
          created_by: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          organization_id: string;
          name: string;
          description?: string | null;
          steps: { event_name: string }[];
          lookback_days?: number;
          created_by?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          name?: string;
          description?: string | null;
          steps?: { event_name: string }[];
          lookback_days?: number;
          updated_at?: string;
        };
      };
      saved_insights: {
        Row: {
          id: string;
          organization_id: string;
          created_by: string | null;
          source: string;
          content: string;
          context: string | null;
          created_at: string;
        };
        Insert: {
          id?: string;
          organization_id: string;
          created_by?: string | null;
          source: string;
          content: string;
          context?: string | null;
          created_at?: string;
        };
        Update: {
          content?: string;
          context?: string | null;
        };
      };
      ai_conversations: {
        Row: {
          id: string;
          organization_id: string;
          created_by: string | null;
          title: string;
          messages: { role: "user" | "assistant"; content: string }[];
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          organization_id: string;
          created_by?: string | null;
          title?: string;
          messages?: { role: "user" | "assistant"; content: string }[];
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          title?: string;
          messages?: { role: "user" | "assistant"; content: string }[];
          updated_at?: string;
        };
      };
      ai_business_briefs: {
        Row: {
          id: string;
          organization_id: string;
          created_by: string | null;
          content: string;
          created_at: string;
        };
        Insert: {
          id?: string;
          organization_id: string;
          created_by?: string | null;
          content: string;
          created_at?: string;
        };
        Update: {
          content?: string;
        };
      };
      events: {
        Row: {
          id: string;
          organization_id: string;
          name: string;
          properties: Json;
          user_id: string | null;
          session_id: string | null;
          timestamp: string;
          created_at: string;
        };
        Insert: {
          id?: string;
          organization_id: string;
          name: string;
          properties?: Json;
          user_id?: string | null;
          session_id?: string | null;
          timestamp?: string;
          created_at?: string;
        };
        Update: never;
      };
      brand_settings: {
        Row: {
          id: string;
          organization_id: string;
          company_name: string | null;
          logo_url: string | null;
          primary_color: string;
          secondary_color: string;
          slack_webhook: string | null;
          slack_digest_enabled: boolean;
          slack_digest_cadence: string;
          pm_status_alerts_enabled: boolean;
          pm_weekly_digest_enabled: boolean;
          mixpanel_username: string | null;
          mixpanel_api_secret: string | null;
          mixpanel_project_id: string | null;
          mixpanel_data_region: string;
          mixpanel_raw_synced_until: string | null;
          amplitude_api_key: string | null;
          amplitude_secret_key: string | null;
          amplitude_data_region: string;
          amplitude_raw_synced_until: string | null;
          design_theme: string;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          organization_id: string;
          company_name?: string | null;
          logo_url?: string | null;
          primary_color?: string;
          secondary_color?: string;
          slack_webhook?: string | null;
          slack_digest_enabled?: boolean;
          slack_digest_cadence?: string;
          pm_status_alerts_enabled?: boolean;
          pm_weekly_digest_enabled?: boolean;
          mixpanel_username?: string | null;
          mixpanel_api_secret?: string | null;
          mixpanel_project_id?: string | null;
          mixpanel_data_region?: string;
          mixpanel_raw_synced_until?: string | null;
          amplitude_api_key?: string | null;
          amplitude_secret_key?: string | null;
          amplitude_data_region?: string;
          amplitude_raw_synced_until?: string | null;
          design_theme?: string;
        };
        Update: {
          company_name?: string | null;
          logo_url?: string | null;
          primary_color?: string;
          secondary_color?: string;
          slack_webhook?: string | null;
          slack_digest_enabled?: boolean;
          slack_digest_cadence?: string;
          pm_status_alerts_enabled?: boolean;
          pm_weekly_digest_enabled?: boolean;
          mixpanel_username?: string | null;
          mixpanel_api_secret?: string | null;
          mixpanel_project_id?: string | null;
          mixpanel_data_region?: string;
          mixpanel_raw_synced_until?: string | null;
          amplitude_api_key?: string | null;
          amplitude_secret_key?: string | null;
          amplitude_data_region?: string;
          amplitude_raw_synced_until?: string | null;
          design_theme?: string;
          updated_at?: string;
        };
      };
      report_templates: {
        Row: {
          id: string;
          organization_id: string;
          name: string;
          instructions: string;
          slide_hint: number;
          order_index: number;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          organization_id: string;
          name: string;
          instructions: string;
          slide_hint?: number;
          order_index?: number;
        };
        Update: {
          name?: string;
          instructions?: string;
          slide_hint?: number;
          order_index?: number;
          updated_at?: string;
        };
      };
      report_sources: {
        Row: {
          id: string;
          organization_id: string;
          name: string;
          sheet_url: string;
          last_fetched_at: string | null;
          cached_data: Json | null;
          data_type: string | null;
          parameters: Json;
          expected_insights: Json;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          organization_id: string;
          name: string;
          sheet_url: string;
          data_type?: string | null;
          parameters?: Json;
          expected_insights?: Json;
        };
        Update: {
          name?: string;
          sheet_url?: string;
          last_fetched_at?: string;
          cached_data?: Json;
          data_type?: string | null;
          parameters?: Json;
          expected_insights?: Json;
          updated_at?: string;
        };
      };
      reports: {
        Row: {
          id: string;
          organization_id: string;
          template_id: string | null;
          template_name: string;
          period: string;
          file_url: string | null;
          status: "pending" | "generating" | "done" | "failed";
          error: string | null;
          tokens_used: number;
          slides_count: number;
          ai_model: string | null;
          created_by: string | null;
          created_at: string;
        };
        Insert: {
          id?: string;
          organization_id: string;
          template_id?: string | null;
          template_name: string;
          period: string;
          file_url?: string | null;
          status?: "pending" | "generating" | "done" | "failed";
          error?: string | null;
          tokens_used?: number;
          slides_count?: number;
          ai_model?: string | null;
          created_by?: string | null;
        };
        Update: {
          file_url?: string | null;
          status?: "pending" | "generating" | "done" | "failed";
          error?: string | null;
          tokens_used?: number;
          slides_count?: number;
          ai_model?: string | null;
        };
      };
      report_reviews: {
        Row: {
          id: string;
          organization_id: string | null;
          deck_json: unknown;
          deck_title: string;
          period: string;
          share_token: string;
          created_by: string | null;
          created_at: string;
          status: "open" | "closed";
        };
        Insert: {
          id?: string;
          organization_id?: string | null;
          deck_json: unknown;
          deck_title: string;
          period: string;
          share_token: string;
          created_by?: string | null;
          status?: "open" | "closed";
        };
        Update: {
          status?: "open" | "closed";
          deck_json?: unknown;
        };
      };
      slide_comments: {
        Row: {
          id: string;
          review_id: string;
          slide_index: number;
          reviewer_name: string;
          comment_text: string;
          resolved: boolean;
          created_at: string;
        };
        Insert: {
          id?: string;
          review_id: string;
          slide_index: number;
          reviewer_name?: string;
          comment_text: string;
          resolved?: boolean;
        };
        Update: {
          resolved?: boolean;
        };
      };
      business_goals: {
        Row: {
          id: string;
          organization_id: string;
          created_by: string | null;
          title: string;
          description: string | null;
          type: "revenue" | "growth" | "retention" | "operational" | "product" | "market";
          target: string | null;
          timeframe: string | null;
          start_date: string | null;
          end_date: string | null;
          status: "active" | "achieved" | "missed" | "dropped";
          // Which company-wide objective this product goal ladders up to —
          // see company_objectives below. Nullable: not every goal has been
          // assigned one yet.
          company_objective_id: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          organization_id: string;
          created_by?: string | null;
          title: string;
          description?: string | null;
          type?: "revenue" | "growth" | "retention" | "operational" | "product" | "market";
          target?: string | null;
          timeframe?: string | null;
          start_date?: string | null;
          end_date?: string | null;
          status?: "active" | "achieved" | "missed" | "dropped";
          company_objective_id?: string | null;
        };
        Update: {
          title?: string;
          description?: string | null;
          type?: "revenue" | "growth" | "retention" | "operational" | "product" | "market";
          target?: string | null;
          timeframe?: string | null;
          start_date?: string | null;
          end_date?: string | null;
          status?: "active" | "achieved" | "missed" | "dropped";
          company_objective_id?: string | null;
          updated_at?: string;
        };
      };
      // The real, company-wide "Business Goal" — the one big thing for the
      // quarter/year that business_goals (renamed "Product Goals" in the UI)
      // ladder up to via company_objective_id above.
      company_objectives: {
        Row: {
          id: string;
          organization_id: string;
          created_by: string | null;
          title: string;
          description: string | null;
          target: string | null;
          timeframe: string | null;
          status: "active" | "achieved" | "missed" | "dropped";
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          organization_id: string;
          created_by?: string | null;
          title: string;
          description?: string | null;
          target?: string | null;
          timeframe?: string | null;
          status?: "active" | "achieved" | "missed" | "dropped";
        };
        Update: {
          title?: string;
          description?: string | null;
          target?: string | null;
          timeframe?: string | null;
          status?: "active" | "achieved" | "missed" | "dropped";
          updated_at?: string;
        };
      };
      feature_metrics: {
        Row: {
          id: string;
          organization_id: string;
          created_by: string | null;
          feature_name: string;
          feature_description: string | null;
          sector: string | null;
          target_users: string | null;
          success_definition: string | null;
          failure_definition: string | null;
          interaction_frequency: string | null;
          launch_timeline: string | null;
          suggestions: FeatureSuggestion[];
          business_goal_id: string | null;
          target_kpi_id: string | null;
          goal_alignment: string | null;
          status: "active" | "archived";
          planned_launch_date: string | null;
          actual_launch_date: string | null;
          launch_status: "ideation" | "design" | "dev" | "uat" | "ready_for_launch" | "deployed" | "launched" | "post_launch" | "rolled_back" | "paused" | "not_launched" | "delayed" | "cancelled";
          pm_slack_handle: string | null;
          status_log: { status: string; timestamp: string; note?: string }[];
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          organization_id: string;
          created_by?: string | null;
          feature_name: string;
          feature_description?: string | null;
          sector?: string | null;
          target_users?: string | null;
          success_definition?: string | null;
          failure_definition?: string | null;
          interaction_frequency?: string | null;
          launch_timeline?: string | null;
          suggestions?: FeatureSuggestion[];
          business_goal_id?: string | null;
          target_kpi_id?: string | null;
          goal_alignment?: string | null;
          status?: "active" | "archived";
          planned_launch_date?: string | null;
          actual_launch_date?: string | null;
          launch_status?: "not_launched" | "launched" | "delayed" | "cancelled";
          pm_slack_handle?: string | null;
          status_log?: { status: string; timestamp: string; note?: string }[];
        };
        Update: {
          suggestions?: FeatureSuggestion[];
          business_goal_id?: string | null;
          target_kpi_id?: string | null;
          goal_alignment?: string | null;
          status?: "active" | "archived";
          planned_launch_date?: string | null;
          actual_launch_date?: string | null;
          launch_status?: "not_launched" | "launched" | "delayed" | "cancelled";
          pm_slack_handle?: string | null;
          status_log?: { status: string; timestamp: string; note?: string }[];
          updated_at?: string;
        };
      };
    };
    Views: {
      [_ in never]: never;
    };
    Functions: {
      [_ in never]: never;
    };
    Enums: {
      member_role: "owner" | "admin" | "member" | "viewer";
    };
  };
}

// ── Shared types ──────────────────────────────────────────────────────────────

export type FeatureSuggestion = {
  type: "metric" | "kpi" | "guardrail";
  name: string;
  description: string;
  how_to_track: string;
  event_name: string | null;   // suggested event to fire (e.g. "feature_x_used")
  // Optional second event — some metrics/guardrails are inherently a ratio
  // (e.g. "abandonment rate" = claim_submitted ÷ claim_start_clicked), not a
  // standalone count. When set, this becomes the reference event the
  // primary one is measured against — same shape as a KPI's
  // denominator_event_name (see metrics.ts), and saveFeatureMetric carries
  // it through to the auto-created metrics row so it's actually computed as
  // a ratio, not just noted in prose.
  compared_event_name: string | null;
  target: string | null;        // e.g. "> 25% adoption in 30 days"
  frequency: "daily" | "weekly" | "monthly";
};

export type FeatureInput = {
  feature_name: string;
  feature_description: string;
  sector: string;
  target_users: string;
  success_definition: string;
  failure_definition: string;
  interaction_frequency: string;
  launch_timeline: string;
  pm_slack_handle?: string;
};

// ── Table row aliases ─────────────────────────────────────────────────────────

export type Organization =
  Database["public"]["Tables"]["organizations"]["Row"];
export type OrganizationMember =
  Database["public"]["Tables"]["organization_members"]["Row"];
export type Profile = Database["public"]["Tables"]["profiles"]["Row"];
export type Event = Database["public"]["Tables"]["events"]["Row"];
export type MemberRole = Database["public"]["Enums"]["member_role"];
export type Metric = Database["public"]["Tables"]["metrics"]["Row"];
export type Funnel = Database["public"]["Tables"]["funnels"]["Row"];
export type BrandSettings = Database["public"]["Tables"]["brand_settings"]["Row"];
export type ReportTemplate = Database["public"]["Tables"]["report_templates"]["Row"];
export type ReportSource = Database["public"]["Tables"]["report_sources"]["Row"];
export type Report = Database["public"]["Tables"]["reports"]["Row"];
export type FeatureMetric = Database["public"]["Tables"]["feature_metrics"]["Row"];
export type BusinessGoal = Database["public"]["Tables"]["business_goals"]["Row"];
// The real, company-wide objective — see company_objectives migration notes.
export type CompanyObjective = Database["public"]["Tables"]["company_objectives"]["Row"];
export type BusinessGoalType = BusinessGoal["type"];
