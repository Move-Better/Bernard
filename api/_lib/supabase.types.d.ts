// GENERATED FILE — do not hand-edit. Regenerate via scripts/write-supabase-types.mjs.
// Source: Supabase MCP generate_typescript_types, public schema.
// Generated: 2026-09-04T18:42:27.816Z
//
// See ARCHITECTURE.md "Generated DB types (api/_lib/supabase.types.d.ts)" for:
//   - the opt-in consumption pattern (// @ts-check + a tsconfig.json include entry)
//   - what this catches (a column that was renamed/dropped/never applied) vs.
//     what it does NOT catch (a SELECT/PATCH column-list mismatch on an
//     explicit-column select=; free-form JSONB shapes like media_urls)
//   - the regeneration workflow — this file has no unattended/CI fetch path
//
// Sibling artifact: supabase/expected-schema.json (npm run schema:snapshot /
// schema:verify) — regenerate both together, same live-schema source.
// Table count at generation time: 60

export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "14.5"
  }
  public: {
    Tables: {
      ad_creatives: {
        Row: {
          campaign_id: string | null
          caption: string | null
          created_at: string
          created_by: string | null
          id: string
          media_type: string
          sizes: Json
          source_asset_id: string | null
          source_piece_id: string | null
          title: string | null
          treatment: Json | null
          updated_at: string
          workspace_id: string
        }
        Insert: {
          campaign_id?: string | null
          caption?: string | null
          created_at?: string
          created_by?: string | null
          id?: string
          media_type?: string
          sizes?: Json
          source_asset_id?: string | null
          source_piece_id?: string | null
          title?: string | null
          treatment?: Json | null
          updated_at?: string
          workspace_id: string
        }
        Update: {
          campaign_id?: string | null
          caption?: string | null
          created_at?: string
          created_by?: string | null
          id?: string
          media_type?: string
          sizes?: Json
          source_asset_id?: string | null
          source_piece_id?: string | null
          title?: string | null
          treatment?: Json | null
          updated_at?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "ad_creatives_campaign_id_fkey"
            columns: ["campaign_id"]
            isOneToOne: false
            referencedRelation: "campaigns"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ad_creatives_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      agent_actions: {
        Row: {
          actor: string
          atom_id: string | null
          content_item_id: string | null
          created_at: string
          detail: Json | null
          id: string
          inbox_item_id: string | null
          input_tokens: number | null
          interview_id: string | null
          kind: string
          model: string | null
          output_tokens: number | null
          package_id: string | null
          title: string
          workspace_id: string
        }
        Insert: {
          actor?: string
          atom_id?: string | null
          content_item_id?: string | null
          created_at?: string
          detail?: Json | null
          id?: string
          inbox_item_id?: string | null
          input_tokens?: number | null
          interview_id?: string | null
          kind: string
          model?: string | null
          output_tokens?: number | null
          package_id?: string | null
          title: string
          workspace_id: string
        }
        Update: {
          actor?: string
          atom_id?: string | null
          content_item_id?: string | null
          created_at?: string
          detail?: Json | null
          id?: string
          inbox_item_id?: string | null
          input_tokens?: number | null
          interview_id?: string | null
          kind?: string
          model?: string | null
          output_tokens?: number | null
          package_id?: string | null
          title?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "agent_actions_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      agent_inbox: {
        Row: {
          attempts: number
          claimed_at: string | null
          content_item_id: string | null
          created_at: string
          dedupe_key: string
          id: string
          kind: string
          payload: Json
          processed_at: string | null
          result: Json | null
          status: string
          workspace_id: string
        }
        Insert: {
          attempts?: number
          claimed_at?: string | null
          content_item_id?: string | null
          created_at?: string
          dedupe_key: string
          id?: string
          kind: string
          payload?: Json
          processed_at?: string | null
          result?: Json | null
          status?: string
          workspace_id: string
        }
        Update: {
          attempts?: number
          claimed_at?: string | null
          content_item_id?: string | null
          created_at?: string
          dedupe_key?: string
          id?: string
          kind?: string
          payload?: Json
          processed_at?: string | null
          result?: Json | null
          status?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "agent_inbox_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      answers: {
        Row: {
          answer_lead: string | null
          body: string | null
          chat_prompts: Json | null
          condition: string | null
          created_at: string
          display_order: number | null
          grounding_source: string | null
          id: string
          movebetterco_slug: string | null
          published_at: string | null
          question: string
          review_notes: string | null
          review_reason: string | null
          seo_title: string | null
          slug: string
          source: string
          staff_id: string | null
          status: string
          summary: string | null
          superseded_at: string | null
          superseded_by: string | null
          updated_at: string
          voice_audit: Json | null
          voice_fidelity_score: number | null
          voice_rechecked_at: string | null
          workspace_id: string
        }
        Insert: {
          answer_lead?: string | null
          body?: string | null
          chat_prompts?: Json | null
          condition?: string | null
          created_at?: string
          display_order?: number | null
          grounding_source?: string | null
          id?: string
          movebetterco_slug?: string | null
          published_at?: string | null
          question: string
          review_notes?: string | null
          review_reason?: string | null
          seo_title?: string | null
          slug: string
          source?: string
          staff_id?: string | null
          status?: string
          summary?: string | null
          superseded_at?: string | null
          superseded_by?: string | null
          updated_at?: string
          voice_audit?: Json | null
          voice_fidelity_score?: number | null
          voice_rechecked_at?: string | null
          workspace_id: string
        }
        Update: {
          answer_lead?: string | null
          body?: string | null
          chat_prompts?: Json | null
          condition?: string | null
          created_at?: string
          display_order?: number | null
          grounding_source?: string | null
          id?: string
          movebetterco_slug?: string | null
          published_at?: string | null
          question?: string
          review_notes?: string | null
          review_reason?: string | null
          seo_title?: string | null
          slug?: string
          source?: string
          staff_id?: string | null
          status?: string
          summary?: string | null
          superseded_at?: string | null
          superseded_by?: string | null
          updated_at?: string
          voice_audit?: Json | null
          voice_fidelity_score?: number | null
          voice_rechecked_at?: string | null
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "answers_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      app_config: {
        Row: {
          key: string
          updated_at: string
          value: Json
        }
        Insert: {
          key: string
          updated_at?: string
          value?: Json
        }
        Update: {
          key?: string
          updated_at?: string
          value?: Json
        }
        Relationships: []
      }
      apple_insights: {
        Row: {
          call: number | null
          created_at: string
          directions: number | null
          id: string
          location_id: string | null
          location_label: string | null
          period_month: string
          photos: number | null
          place_card_views: number | null
          raw_extract: Json | null
          source: string
          taps_from_search: number | null
          taps_yoy_pct: number | null
          updated_at: string
          views_yoy_pct: number | null
          website: number | null
          workspace_id: string
        }
        Insert: {
          call?: number | null
          created_at?: string
          directions?: number | null
          id?: string
          location_id?: string | null
          location_label?: string | null
          period_month: string
          photos?: number | null
          place_card_views?: number | null
          raw_extract?: Json | null
          source?: string
          taps_from_search?: number | null
          taps_yoy_pct?: number | null
          updated_at?: string
          views_yoy_pct?: number | null
          website?: number | null
          workspace_id: string
        }
        Update: {
          call?: number | null
          created_at?: string
          directions?: number | null
          id?: string
          location_id?: string | null
          location_label?: string | null
          period_month?: string
          photos?: number | null
          place_card_views?: number | null
          raw_extract?: Json | null
          source?: string
          taps_from_search?: number | null
          taps_yoy_pct?: number | null
          updated_at?: string
          views_yoy_pct?: number | null
          website?: number | null
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "apple_insights_location_id_fkey"
            columns: ["location_id"]
            isOneToOne: false
            referencedRelation: "workspace_locations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "apple_insights_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      blog_citations: {
        Row: {
          claim_quote: string
          claim_text: string
          confidence: number
          content_item_id: string
          created_at: string
          decided_at: string | null
          decided_by: string | null
          id: string
          source: string
          source_title: string | null
          source_type: string | null
          source_url: string
          status: string
          updated_at: string
          verify_evidence: string
          why_match: string
          workspace_id: string
        }
        Insert: {
          claim_quote?: string
          claim_text: string
          confidence?: number
          content_item_id: string
          created_at?: string
          decided_at?: string | null
          decided_by?: string | null
          id?: string
          source: string
          source_title?: string | null
          source_type?: string | null
          source_url: string
          status?: string
          updated_at?: string
          verify_evidence?: string
          why_match?: string
          workspace_id: string
        }
        Update: {
          claim_quote?: string
          claim_text?: string
          confidence?: number
          content_item_id?: string
          created_at?: string
          decided_at?: string | null
          decided_by?: string | null
          id?: string
          source?: string
          source_title?: string | null
          source_type?: string | null
          source_url?: string
          status?: string
          updated_at?: string
          verify_evidence?: string
          why_match?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "blog_citations_content_item_id_fkey"
            columns: ["content_item_id"]
            isOneToOne: false
            referencedRelation: "content_items"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "blog_citations_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      book_excluded_sources: {
        Row: {
          excluded_at: string
          excluded_by: string | null
          id: string
          reason: string | null
          source_id: string
          source_table: string
          workspace_id: string
        }
        Insert: {
          excluded_at?: string
          excluded_by?: string | null
          id?: string
          reason?: string | null
          source_id: string
          source_table: string
          workspace_id: string
        }
        Update: {
          excluded_at?: string
          excluded_by?: string | null
          id?: string
          reason?: string | null
          source_id?: string
          source_table?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "book_excluded_sources_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      book_pinned_chapters: {
        Row: {
          chapter_md: string
          chapter_slug: string
          chapter_title: string
          id: string
          pinned_at: string
          pinned_by: string | null
          position_hint: number | null
          workspace_id: string
        }
        Insert: {
          chapter_md: string
          chapter_slug: string
          chapter_title: string
          id?: string
          pinned_at?: string
          pinned_by?: string | null
          position_hint?: number | null
          workspace_id: string
        }
        Update: {
          chapter_md?: string
          chapter_slug?: string
          chapter_title?: string
          id?: string
          pinned_at?: string
          pinned_by?: string | null
          position_hint?: number | null
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "book_pinned_chapters_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      brand_assets: {
        Row: {
          ai_classification: Json | null
          background: string | null
          blob_pathname: string
          blob_url: string
          byte_size: number
          color_mode: string | null
          filename_tokens: string[]
          has_alpha: boolean | null
          height: number | null
          id: string
          mime_type: string
          original_filename: string
          shape: string | null
          uploaded_at: string
          uploaded_by: string | null
          user_tags: string[]
          width: number | null
          workspace_id: string
        }
        Insert: {
          ai_classification?: Json | null
          background?: string | null
          blob_pathname: string
          blob_url: string
          byte_size: number
          color_mode?: string | null
          filename_tokens?: string[]
          has_alpha?: boolean | null
          height?: number | null
          id?: string
          mime_type: string
          original_filename: string
          shape?: string | null
          uploaded_at?: string
          uploaded_by?: string | null
          user_tags?: string[]
          width?: number | null
          workspace_id: string
        }
        Update: {
          ai_classification?: Json | null
          background?: string | null
          blob_pathname?: string
          blob_url?: string
          byte_size?: number
          color_mode?: string | null
          filename_tokens?: string[]
          has_alpha?: boolean | null
          height?: number | null
          id?: string
          mime_type?: string
          original_filename?: string
          shape?: string | null
          uploaded_at?: string
          uploaded_by?: string | null
          user_tags?: string[]
          width?: number | null
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "brand_assets_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      brand_discovery_interviews: {
        Row: {
          completed_at: string | null
          created_at: string
          id: string
          messages: Json
          owner_id: string
          session_state: Json | null
          staff_id: string | null
          status: string
          synthesis_result: Json | null
          synthesized_at: string | null
          updated_at: string
          workspace_id: string
        }
        Insert: {
          completed_at?: string | null
          created_at?: string
          id?: string
          messages?: Json
          owner_id: string
          session_state?: Json | null
          staff_id?: string | null
          status?: string
          synthesis_result?: Json | null
          synthesized_at?: string | null
          updated_at?: string
          workspace_id: string
        }
        Update: {
          completed_at?: string | null
          created_at?: string
          id?: string
          messages?: Json
          owner_id?: string
          session_state?: Json | null
          staff_id?: string | null
          status?: string
          synthesis_result?: Json | null
          synthesized_at?: string | null
          updated_at?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "brand_discovery_interviews_staff_id_fkey"
            columns: ["staff_id"]
            isOneToOne: false
            referencedRelation: "staff"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "brand_discovery_interviews_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      brand_kit_roles: {
        Row: {
          asset_id: string
          assigned_at: string
          assigned_by: string | null
          role: string
          workspace_id: string
        }
        Insert: {
          asset_id: string
          assigned_at?: string
          assigned_by?: string | null
          role: string
          workspace_id: string
        }
        Update: {
          asset_id?: string
          assigned_at?: string
          assigned_by?: string | null
          role?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "brand_kit_roles_asset_id_fkey"
            columns: ["asset_id"]
            isOneToOne: false
            referencedRelation: "brand_assets"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "brand_kit_roles_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      briefs: {
        Row: {
          body: string
          created_at: string
          cta_label: string | null
          cta_url: string | null
          event_at: string | null
          id: string
          location: string | null
          media_url: string | null
          selected_outputs: string[]
          status: string
          title: string
          updated_at: string
          workspace_id: string
        }
        Insert: {
          body: string
          created_at?: string
          cta_label?: string | null
          cta_url?: string | null
          event_at?: string | null
          id?: string
          location?: string | null
          media_url?: string | null
          selected_outputs?: string[]
          status?: string
          title: string
          updated_at?: string
          workspace_id: string
        }
        Update: {
          body?: string
          created_at?: string
          cta_label?: string | null
          cta_url?: string | null
          event_at?: string | null
          id?: string
          location?: string | null
          media_url?: string | null
          selected_outputs?: string[]
          status?: string
          title?: string
          updated_at?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "briefs_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      campaigns: {
        Row: {
          ai_tune_state: Json | null
          ai_tuned_at: string | null
          content_style: string
          created_at: string
          created_by: string | null
          cta_label: string | null
          cta_pitch: string | null
          cta_url: string | null
          description: string | null
          end_at: string | null
          event_at: string | null
          id: string
          name: string
          start_at: string | null
          status: string
          target_location_id: string | null
          target_staff_ids: string[]
          theme_notes: string | null
          updated_at: string
          workspace_id: string
        }
        Insert: {
          ai_tune_state?: Json | null
          ai_tuned_at?: string | null
          content_style?: string
          created_at?: string
          created_by?: string | null
          cta_label?: string | null
          cta_pitch?: string | null
          cta_url?: string | null
          description?: string | null
          end_at?: string | null
          event_at?: string | null
          id?: string
          name: string
          start_at?: string | null
          status?: string
          target_location_id?: string | null
          target_staff_ids?: string[]
          theme_notes?: string | null
          updated_at?: string
          workspace_id: string
        }
        Update: {
          ai_tune_state?: Json | null
          ai_tuned_at?: string | null
          content_style?: string
          created_at?: string
          created_by?: string | null
          cta_label?: string | null
          cta_pitch?: string | null
          cta_url?: string | null
          description?: string | null
          end_at?: string | null
          event_at?: string | null
          id?: string
          name?: string
          start_at?: string | null
          status?: string
          target_location_id?: string | null
          target_staff_ids?: string[]
          theme_notes?: string | null
          updated_at?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "campaigns_target_location_id_fkey"
            columns: ["target_location_id"]
            isOneToOne: false
            referencedRelation: "workspace_locations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "campaigns_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      clinic_settings: {
        Row: {
          campaign_cta_label: string | null
          campaign_cta_pitch: string | null
          campaign_cta_url: string | null
          campaign_event_at: string | null
          campaign_mode: string | null
          campaign_notes: string | null
          updated_at: string
          updated_by: string | null
          workspace_id: string
        }
        Insert: {
          campaign_cta_label?: string | null
          campaign_cta_pitch?: string | null
          campaign_cta_url?: string | null
          campaign_event_at?: string | null
          campaign_mode?: string | null
          campaign_notes?: string | null
          updated_at?: string
          updated_by?: string | null
          workspace_id: string
        }
        Update: {
          campaign_cta_label?: string | null
          campaign_cta_pitch?: string | null
          campaign_cta_url?: string | null
          campaign_event_at?: string | null
          campaign_mode?: string | null
          campaign_notes?: string | null
          updated_at?: string
          updated_by?: string | null
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "clinic_settings_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: true
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      clip_render_jobs: {
        Row: {
          blob_pathname: string | null
          blob_url: string | null
          created_at: string
          duration_s: number | null
          error: string | null
          had_subtitles: boolean | null
          height: number | null
          id: string
          size_bytes: number | null
          status: string
          updated_at: string
          width: number | null
          workspace_id: string
        }
        Insert: {
          blob_pathname?: string | null
          blob_url?: string | null
          created_at?: string
          duration_s?: number | null
          error?: string | null
          had_subtitles?: boolean | null
          height?: number | null
          id?: string
          size_bytes?: number | null
          status?: string
          updated_at?: string
          width?: number | null
          workspace_id: string
        }
        Update: {
          blob_pathname?: string | null
          blob_url?: string | null
          created_at?: string
          duration_s?: number | null
          error?: string | null
          had_subtitles?: boolean | null
          height?: number | null
          id?: string
          size_bytes?: number | null
          status?: string
          updated_at?: string
          width?: number | null
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "clip_render_jobs_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      collection_items: {
        Row: {
          added_at: string
          added_by: string | null
          asset_id: string
          collection_id: string
          position: number | null
        }
        Insert: {
          added_at?: string
          added_by?: string | null
          asset_id: string
          collection_id: string
          position?: number | null
        }
        Update: {
          added_at?: string
          added_by?: string | null
          asset_id?: string
          collection_id?: string
          position?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "collection_items_asset_id_fkey"
            columns: ["asset_id"]
            isOneToOne: false
            referencedRelation: "media_assets"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "collection_items_collection_id_fkey"
            columns: ["collection_id"]
            isOneToOne: false
            referencedRelation: "collections"
            referencedColumns: ["id"]
          },
        ]
      }
      collections: {
        Row: {
          cover_asset_id: string | null
          created_at: string
          created_by: string | null
          description: string | null
          id: string
          kind: string | null
          name: string
          slug: string | null
          status: string | null
          updated_at: string
          workspace_id: string
        }
        Insert: {
          cover_asset_id?: string | null
          created_at?: string
          created_by?: string | null
          description?: string | null
          id?: string
          kind?: string | null
          name: string
          slug?: string | null
          status?: string | null
          updated_at?: string
          workspace_id: string
        }
        Update: {
          cover_asset_id?: string | null
          created_at?: string
          created_by?: string | null
          description?: string | null
          id?: string
          kind?: string | null
          name?: string
          slug?: string | null
          status?: string | null
          updated_at?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "collections_cover_asset_id_fkey"
            columns: ["cover_asset_id"]
            isOneToOne: false
            referencedRelation: "media_assets"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "collections_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      concept_mentions: {
        Row: {
          concept_id: string
          created_at: string
          excerpt: string | null
          id: string
          source_id: string | null
          source_kind: string
          staff_id: string | null
          weight_delta: number
          workspace_id: string
        }
        Insert: {
          concept_id: string
          created_at?: string
          excerpt?: string | null
          id?: string
          source_id?: string | null
          source_kind: string
          staff_id?: string | null
          weight_delta?: number
          workspace_id: string
        }
        Update: {
          concept_id?: string
          created_at?: string
          excerpt?: string | null
          id?: string
          source_id?: string | null
          source_kind?: string
          staff_id?: string | null
          weight_delta?: number
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "concept_mentions_concept_id_fkey"
            columns: ["concept_id"]
            isOneToOne: false
            referencedRelation: "workspace_concepts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "concept_mentions_staff_id_fkey"
            columns: ["staff_id"]
            isOneToOne: false
            referencedRelation: "staff"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "concept_mentions_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      content_item_comments: {
        Row: {
          body: string
          content_item_id: string
          created_at: string
          id: string
          kind: string
          user_email: string | null
          user_id: string
          workspace_id: string
        }
        Insert: {
          body: string
          content_item_id: string
          created_at?: string
          id?: string
          kind?: string
          user_email?: string | null
          user_id: string
          workspace_id: string
        }
        Update: {
          body?: string
          content_item_id?: string
          created_at?: string
          id?: string
          kind?: string
          user_email?: string | null
          user_id?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "content_item_comments_content_item_id_fkey"
            columns: ["content_item_id"]
            isOneToOne: false
            referencedRelation: "content_items"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "content_item_comments_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      content_item_drafts: {
        Row: {
          ai_generated: boolean
          body: string
          content_item_id: string
          created_at: string
          id: string
          workspace_id: string
        }
        Insert: {
          ai_generated?: boolean
          body: string
          content_item_id: string
          created_at?: string
          id?: string
          workspace_id: string
        }
        Update: {
          ai_generated?: boolean
          body?: string
          content_item_id?: string
          created_at?: string
          id?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "content_item_drafts_content_item_id_fkey"
            columns: ["content_item_id"]
            isOneToOne: false
            referencedRelation: "content_items"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "content_item_drafts_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      content_items: {
        Row: {
          ai_original_content: string | null
          approved_at: string | null
          approved_by: string | null
          archived_at: string | null
          aspect_ratio: string | null
          auto_published: boolean
          brief_id: string | null
          content: string
          created_at: string
          dispatch_state: Json
          dispatching_at: string | null
          edit_diff: Json | null
          format: string | null
          format_source: string | null
          gbp_post_name: string | null
          hashtag_suggestions: Json | null
          held_at: string | null
          id: string
          interview_id: string | null
          is_model_post: boolean
          length_preset: string | null
          location_id: string | null
          location_overrides: Json | null
          media_source: string | null
          media_urls: Json | null
          meta_description: string | null
          model_marked_at: string | null
          model_note: string | null
          model_reasons: string[] | null
          moment_id: string | null
          moment_provenance: Json | null
          notes: string | null
          overlay_text: Json | null
          performed_well: boolean
          photo_composite_url: string | null
          photo_template_id: string | null
          photo_treatment: Json | null
          platform: string
          platform_post_id: string | null
          point_safety_audit: Json | null
          point_safety_score: number | null
          provenance: Json | null
          publish_error: string | null
          published_at: string | null
          region: string | null
          reject_note: string | null
          reject_reason: string | null
          rejected_at: string | null
          rejected_by: string | null
          resolved_url: string | null
          reviewed_by: string | null
          scheduled_at: string | null
          seo_title: string | null
          series_id: string | null
          series_part: number | null
          series_total: number | null
          slides: Json | null
          staff_id: string | null
          staff_name: string | null
          status: string | null
          target_locations: Json | null
          text_card: Json | null
          theme: string | null
          topic: string | null
          updated_at: string
          video_edit: Json | null
          voice_audit: Json | null
          voice_fidelity_score: number | null
          workspace_id: string
        }
        Insert: {
          ai_original_content?: string | null
          approved_at?: string | null
          approved_by?: string | null
          archived_at?: string | null
          aspect_ratio?: string | null
          auto_published?: boolean
          brief_id?: string | null
          content: string
          created_at?: string
          dispatch_state?: Json
          dispatching_at?: string | null
          edit_diff?: Json | null
          format?: string | null
          format_source?: string | null
          gbp_post_name?: string | null
          hashtag_suggestions?: Json | null
          held_at?: string | null
          id?: string
          interview_id?: string | null
          is_model_post?: boolean
          length_preset?: string | null
          location_id?: string | null
          location_overrides?: Json | null
          media_source?: string | null
          media_urls?: Json | null
          meta_description?: string | null
          model_marked_at?: string | null
          model_note?: string | null
          model_reasons?: string[] | null
          moment_id?: string | null
          moment_provenance?: Json | null
          notes?: string | null
          overlay_text?: Json | null
          performed_well?: boolean
          photo_composite_url?: string | null
          photo_template_id?: string | null
          photo_treatment?: Json | null
          platform: string
          platform_post_id?: string | null
          point_safety_audit?: Json | null
          point_safety_score?: number | null
          provenance?: Json | null
          publish_error?: string | null
          published_at?: string | null
          region?: string | null
          reject_note?: string | null
          reject_reason?: string | null
          rejected_at?: string | null
          rejected_by?: string | null
          resolved_url?: string | null
          reviewed_by?: string | null
          scheduled_at?: string | null
          seo_title?: string | null
          series_id?: string | null
          series_part?: number | null
          series_total?: number | null
          slides?: Json | null
          staff_id?: string | null
          staff_name?: string | null
          status?: string | null
          target_locations?: Json | null
          text_card?: Json | null
          theme?: string | null
          topic?: string | null
          updated_at?: string
          video_edit?: Json | null
          voice_audit?: Json | null
          voice_fidelity_score?: number | null
          workspace_id: string
        }
        Update: {
          ai_original_content?: string | null
          approved_at?: string | null
          approved_by?: string | null
          archived_at?: string | null
          aspect_ratio?: string | null
          auto_published?: boolean
          brief_id?: string | null
          content?: string
          created_at?: string
          dispatch_state?: Json
          dispatching_at?: string | null
          edit_diff?: Json | null
          format?: string | null
          format_source?: string | null
          gbp_post_name?: string | null
          hashtag_suggestions?: Json | null
          held_at?: string | null
          id?: string
          interview_id?: string | null
          is_model_post?: boolean
          length_preset?: string | null
          location_id?: string | null
          location_overrides?: Json | null
          media_source?: string | null
          media_urls?: Json | null
          meta_description?: string | null
          model_marked_at?: string | null
          model_note?: string | null
          model_reasons?: string[] | null
          moment_id?: string | null
          moment_provenance?: Json | null
          notes?: string | null
          overlay_text?: Json | null
          performed_well?: boolean
          photo_composite_url?: string | null
          photo_template_id?: string | null
          photo_treatment?: Json | null
          platform?: string
          platform_post_id?: string | null
          point_safety_audit?: Json | null
          point_safety_score?: number | null
          provenance?: Json | null
          publish_error?: string | null
          published_at?: string | null
          region?: string | null
          reject_note?: string | null
          reject_reason?: string | null
          rejected_at?: string | null
          rejected_by?: string | null
          resolved_url?: string | null
          reviewed_by?: string | null
          scheduled_at?: string | null
          seo_title?: string | null
          series_id?: string | null
          series_part?: number | null
          series_total?: number | null
          slides?: Json | null
          staff_id?: string | null
          staff_name?: string | null
          status?: string | null
          target_locations?: Json | null
          text_card?: Json | null
          theme?: string | null
          topic?: string | null
          updated_at?: string
          video_edit?: Json | null
          voice_audit?: Json | null
          voice_fidelity_score?: number | null
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "content_items_brief_id_fkey"
            columns: ["brief_id"]
            isOneToOne: false
            referencedRelation: "briefs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "content_items_interview_id_fkey"
            columns: ["interview_id"]
            isOneToOne: false
            referencedRelation: "interviews"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "content_items_location_id_fkey"
            columns: ["location_id"]
            isOneToOne: false
            referencedRelation: "workspace_locations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "content_items_moment_id_fkey"
            columns: ["moment_id"]
            isOneToOne: false
            referencedRelation: "moments"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "content_items_staff_id_fkey"
            columns: ["staff_id"]
            isOneToOne: false
            referencedRelation: "staff"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "content_items_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      content_pieces: {
        Row: {
          accepted_at: string | null
          ai_caption: string | null
          ai_cta_text: string | null
          ai_generated_at: string | null
          ai_hashtags: Json | null
          ai_model: string | null
          ai_reasoning: string | null
          ai_suggested_platform: string | null
          assigned_to: string | null
          created_at: string
          final_asset_id: string | null
          final_caption: string | null
          final_cta_text: string | null
          final_cta_url: string | null
          final_hashtags: Json | null
          id: string
          notes: string | null
          published_at: string | null
          published_target_id: string | null
          rejected_reason: string | null
          returned_at: string | null
          source_asset_id: string
          source_quote: string | null
          source_trim_end: number | null
          source_trim_start: number | null
          status: string | null
          target_platform: string | null
          updated_at: string
          workspace_id: string
        }
        Insert: {
          accepted_at?: string | null
          ai_caption?: string | null
          ai_cta_text?: string | null
          ai_generated_at?: string | null
          ai_hashtags?: Json | null
          ai_model?: string | null
          ai_reasoning?: string | null
          ai_suggested_platform?: string | null
          assigned_to?: string | null
          created_at?: string
          final_asset_id?: string | null
          final_caption?: string | null
          final_cta_text?: string | null
          final_cta_url?: string | null
          final_hashtags?: Json | null
          id?: string
          notes?: string | null
          published_at?: string | null
          published_target_id?: string | null
          rejected_reason?: string | null
          returned_at?: string | null
          source_asset_id: string
          source_quote?: string | null
          source_trim_end?: number | null
          source_trim_start?: number | null
          status?: string | null
          target_platform?: string | null
          updated_at?: string
          workspace_id: string
        }
        Update: {
          accepted_at?: string | null
          ai_caption?: string | null
          ai_cta_text?: string | null
          ai_generated_at?: string | null
          ai_hashtags?: Json | null
          ai_model?: string | null
          ai_reasoning?: string | null
          ai_suggested_platform?: string | null
          assigned_to?: string | null
          created_at?: string
          final_asset_id?: string | null
          final_caption?: string | null
          final_cta_text?: string | null
          final_cta_url?: string | null
          final_hashtags?: Json | null
          id?: string
          notes?: string | null
          published_at?: string | null
          published_target_id?: string | null
          rejected_reason?: string | null
          returned_at?: string | null
          source_asset_id?: string
          source_quote?: string | null
          source_trim_end?: number | null
          source_trim_start?: number | null
          status?: string | null
          target_platform?: string | null
          updated_at?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "content_pieces_final_asset_id_fkey"
            columns: ["final_asset_id"]
            isOneToOne: false
            referencedRelation: "media_assets"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "content_pieces_source_asset_id_fkey"
            columns: ["source_asset_id"]
            isOneToOne: false
            referencedRelation: "media_assets"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "content_pieces_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      content_plan_atoms: {
        Row: {
          angle: string
          angle_description: string | null
          angle_label: string
          brief: string | null
          content_piece_id: string | null
          created_at: string
          format: string | null
          held_at: string | null
          id: string
          interview_id: string | null
          moment_id: string | null
          plan_week: string | null
          planned_by: string | null
          platform: string
          scheduled_at: string | null
          slot: number
          source_segment_id: string | null
          status: string
          updated_at: string
          workspace_id: string
        }
        Insert: {
          angle: string
          angle_description?: string | null
          angle_label: string
          brief?: string | null
          content_piece_id?: string | null
          created_at?: string
          format?: string | null
          held_at?: string | null
          id?: string
          interview_id?: string | null
          moment_id?: string | null
          plan_week?: string | null
          planned_by?: string | null
          platform: string
          scheduled_at?: string | null
          slot?: number
          source_segment_id?: string | null
          status?: string
          updated_at?: string
          workspace_id: string
        }
        Update: {
          angle?: string
          angle_description?: string | null
          angle_label?: string
          brief?: string | null
          content_piece_id?: string | null
          created_at?: string
          format?: string | null
          held_at?: string | null
          id?: string
          interview_id?: string | null
          moment_id?: string | null
          plan_week?: string | null
          planned_by?: string | null
          platform?: string
          scheduled_at?: string | null
          slot?: number
          source_segment_id?: string | null
          status?: string
          updated_at?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "content_plan_atoms_content_piece_id_fkey"
            columns: ["content_piece_id"]
            isOneToOne: false
            referencedRelation: "content_items"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "content_plan_atoms_interview_id_fkey"
            columns: ["interview_id"]
            isOneToOne: false
            referencedRelation: "interviews"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "content_plan_atoms_moment_id_fkey"
            columns: ["moment_id"]
            isOneToOne: false
            referencedRelation: "moments"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "content_plan_atoms_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      editor_revisions: {
        Row: {
          created_at: string
          doc: Json
          id: string
          label: string | null
          subject_id: string
          subject_type: string
          workspace_id: string
        }
        Insert: {
          created_at?: string
          doc: Json
          id?: string
          label?: string | null
          subject_id: string
          subject_type: string
          workspace_id: string
        }
        Update: {
          created_at?: string
          doc?: Json
          id?: string
          label?: string | null
          subject_id?: string
          subject_type?: string
          workspace_id?: string
        }
        Relationships: []
      }
      engagement_snapshots: {
        Row: {
          content_item_id: string
          fetched_at: string
          id: string
          source: string
          stats: Json
          workspace_id: string
        }
        Insert: {
          content_item_id: string
          fetched_at?: string
          id?: string
          source: string
          stats: Json
          workspace_id: string
        }
        Update: {
          content_item_id?: string
          fetched_at?: string
          id?: string
          source?: string
          stats?: Json
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "engagement_snapshots_content_item_id_fkey"
            columns: ["content_item_id"]
            isOneToOne: false
            referencedRelation: "content_items"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "engagement_snapshots_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      feedback: {
        Row: {
          acknowledged_at: string | null
          created_at: string
          id: string
          message: string
          notify_error: string | null
          notify_ok: boolean | null
          page_url: string | null
          resolved_at: string | null
          resolved_note: string | null
          resolved_notified_at: string | null
          screenshot_url: string | null
          triage_note: string | null
          triaged_at: string | null
          user_email: string | null
          user_id: string | null
          user_name: string | null
          workspace_id: string | null
        }
        Insert: {
          acknowledged_at?: string | null
          created_at?: string
          id?: string
          message: string
          notify_error?: string | null
          notify_ok?: boolean | null
          page_url?: string | null
          resolved_at?: string | null
          resolved_note?: string | null
          resolved_notified_at?: string | null
          screenshot_url?: string | null
          triage_note?: string | null
          triaged_at?: string | null
          user_email?: string | null
          user_id?: string | null
          user_name?: string | null
          workspace_id?: string | null
        }
        Update: {
          acknowledged_at?: string | null
          created_at?: string
          id?: string
          message?: string
          notify_error?: string | null
          notify_ok?: boolean | null
          page_url?: string | null
          resolved_at?: string | null
          resolved_note?: string | null
          resolved_notified_at?: string | null
          screenshot_url?: string | null
          triage_note?: string | null
          triaged_at?: string | null
          user_email?: string | null
          user_id?: string | null
          user_name?: string | null
          workspace_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "feedback_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      gsc_query_snapshots: {
        Row: {
          captured_at: string
          clicks: number
          ctr: number
          id: string
          impressions: number
          page: string | null
          position: number
          query: string
          window_days: number
          workspace_id: string
        }
        Insert: {
          captured_at?: string
          clicks?: number
          ctr?: number
          id?: string
          impressions?: number
          page?: string | null
          position?: number
          query: string
          window_days?: number
          workspace_id: string
        }
        Update: {
          captured_at?: string
          clicks?: number
          ctr?: number
          id?: string
          impressions?: number
          page?: string | null
          position?: number
          query?: string
          window_days?: number
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "gsc_query_snapshots_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      interview_references: {
        Row: {
          added_by: string | null
          created_at: string
          id: string
          interview_id: string | null
          notes: string | null
          title: string | null
          topic_id: string | null
          updated_at: string
          url: string
          use_as_source: boolean
          workspace_id: string
        }
        Insert: {
          added_by?: string | null
          created_at?: string
          id?: string
          interview_id?: string | null
          notes?: string | null
          title?: string | null
          topic_id?: string | null
          updated_at?: string
          url: string
          use_as_source?: boolean
          workspace_id: string
        }
        Update: {
          added_by?: string | null
          created_at?: string
          id?: string
          interview_id?: string | null
          notes?: string | null
          title?: string | null
          topic_id?: string | null
          updated_at?: string
          url?: string
          use_as_source?: boolean
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "interview_references_interview_id_fkey"
            columns: ["interview_id"]
            isOneToOne: false
            referencedRelation: "interviews"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "interview_references_topic_id_fkey"
            columns: ["topic_id"]
            isOneToOne: false
            referencedRelation: "topic_backlog"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "interview_references_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      interviews: {
        Row: {
          audience: string | null
          audio_recording_url: string | null
          campaign_id: string | null
          capture_mode: string
          cleaned_messages: Json | null
          cleanup_level: string | null
          created_at: string
          generation_style: string
          id: string
          kind: string
          location_id: string | null
          messages: Json | null
          outputs: Json | null
          owner_email: string | null
          owner_id: string | null
          paused_at: string | null
          point: string | null
          prototype_id: string | null
          pull_quote_candidates: Json | null
          pull_quote_selected_id: string | null
          realtime_voice_seconds: number | null
          region: string | null
          selected_outputs: string[] | null
          session_state: Json | null
          source_audio_duration_sec: number | null
          source_audio_url: string | null
          source_published_at: string | null
          staff_id: string | null
          status: string | null
          story_type: string | null
          summary_generated_at: string | null
          summary_text: string | null
          theme: string | null
          tone: string | null
          topic: string | null
          transcribe_status: string | null
          turn_timings: Json
          updated_at: string
          verbatim_flags: Json | null
          video_media_asset_id: string | null
          video_offset_seconds: number
          voice_mode: string | null
          words_approved_at: string | null
          words_approved_by: string | null
          workspace_id: string
        }
        Insert: {
          audience?: string | null
          audio_recording_url?: string | null
          campaign_id?: string | null
          capture_mode?: string
          cleaned_messages?: Json | null
          cleanup_level?: string | null
          created_at?: string
          generation_style?: string
          id?: string
          kind?: string
          location_id?: string | null
          messages?: Json | null
          outputs?: Json | null
          owner_email?: string | null
          owner_id?: string | null
          paused_at?: string | null
          point?: string | null
          prototype_id?: string | null
          pull_quote_candidates?: Json | null
          pull_quote_selected_id?: string | null
          realtime_voice_seconds?: number | null
          region?: string | null
          selected_outputs?: string[] | null
          session_state?: Json | null
          source_audio_duration_sec?: number | null
          source_audio_url?: string | null
          source_published_at?: string | null
          staff_id?: string | null
          status?: string | null
          story_type?: string | null
          summary_generated_at?: string | null
          summary_text?: string | null
          theme?: string | null
          tone?: string | null
          topic?: string | null
          transcribe_status?: string | null
          turn_timings?: Json
          updated_at?: string
          verbatim_flags?: Json | null
          video_media_asset_id?: string | null
          video_offset_seconds?: number
          voice_mode?: string | null
          words_approved_at?: string | null
          words_approved_by?: string | null
          workspace_id: string
        }
        Update: {
          audience?: string | null
          audio_recording_url?: string | null
          campaign_id?: string | null
          capture_mode?: string
          cleaned_messages?: Json | null
          cleanup_level?: string | null
          created_at?: string
          generation_style?: string
          id?: string
          kind?: string
          location_id?: string | null
          messages?: Json | null
          outputs?: Json | null
          owner_email?: string | null
          owner_id?: string | null
          paused_at?: string | null
          point?: string | null
          prototype_id?: string | null
          pull_quote_candidates?: Json | null
          pull_quote_selected_id?: string | null
          realtime_voice_seconds?: number | null
          region?: string | null
          selected_outputs?: string[] | null
          session_state?: Json | null
          source_audio_duration_sec?: number | null
          source_audio_url?: string | null
          source_published_at?: string | null
          staff_id?: string | null
          status?: string | null
          story_type?: string | null
          summary_generated_at?: string | null
          summary_text?: string | null
          theme?: string | null
          tone?: string | null
          topic?: string | null
          transcribe_status?: string | null
          turn_timings?: Json
          updated_at?: string
          verbatim_flags?: Json | null
          video_media_asset_id?: string | null
          video_offset_seconds?: number
          voice_mode?: string | null
          words_approved_at?: string | null
          words_approved_by?: string | null
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "interviews_campaign_id_fkey"
            columns: ["campaign_id"]
            isOneToOne: false
            referencedRelation: "campaigns"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "interviews_location_id_fkey"
            columns: ["location_id"]
            isOneToOne: false
            referencedRelation: "workspace_locations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "interviews_staff_id_fkey"
            columns: ["staff_id"]
            isOneToOne: false
            referencedRelation: "staff"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "interviews_video_media_asset_id_fkey"
            columns: ["video_media_asset_id"]
            isOneToOne: false
            referencedRelation: "media_assets"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "interviews_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      media_assets: {
        Row: {
          ai_tags: Json | null
          alt_text: string | null
          archived_at: string | null
          aspect_ratio: string | null
          asset_purpose: string
          blob_pathname: string | null
          blob_url: string | null
          captured_at: string | null
          condition: string | null
          consent_notes: string | null
          consent_status: string
          consent_updated_at: string | null
          consent_updated_by: string | null
          content_item_ids: Json | null
          created_at: string
          created_by: string | null
          display_title: string | null
          drive_id: string | null
          duration_s: number | null
          filename: string | null
          height: number | null
          id: string
          kind: string
          mime_type: string | null
          mux_asset_id: string | null
          mux_playback_id: string | null
          notes: string | null
          original_blob_url: string | null
          parent_asset_id: string | null
          parent_id: string | null
          patient_pseudonym: string | null
          render_error: string | null
          render_proxy_bytes: number | null
          render_proxy_generated_at: string | null
          render_proxy_url: string | null
          render_status: string | null
          rendered_url: string | null
          segment_error: string | null
          segment_status: string | null
          segments_detected_at: string | null
          size_bytes: number | null
          source: string | null
          speaker_role: string | null
          staff_id: string | null
          status: string | null
          tag_error: string | null
          tags: Json | null
          thumbnail_url: string | null
          transcode_status: string | null
          transcript_words: Json | null
          transcription: string | null
          transforms: Json | null
          updated_at: string
          variant_label: string | null
          video_edit_draft: Json | null
          visual_narrative: string | null
          web_blob_url: string | null
          web_height: number | null
          web_width: number | null
          width: number | null
          workspace_id: string
        }
        Insert: {
          ai_tags?: Json | null
          alt_text?: string | null
          archived_at?: string | null
          aspect_ratio?: string | null
          asset_purpose: string
          blob_pathname?: string | null
          blob_url?: string | null
          captured_at?: string | null
          condition?: string | null
          consent_notes?: string | null
          consent_status?: string
          consent_updated_at?: string | null
          consent_updated_by?: string | null
          content_item_ids?: Json | null
          created_at?: string
          created_by?: string | null
          display_title?: string | null
          drive_id?: string | null
          duration_s?: number | null
          filename?: string | null
          height?: number | null
          id?: string
          kind: string
          mime_type?: string | null
          mux_asset_id?: string | null
          mux_playback_id?: string | null
          notes?: string | null
          original_blob_url?: string | null
          parent_asset_id?: string | null
          parent_id?: string | null
          patient_pseudonym?: string | null
          render_error?: string | null
          render_proxy_bytes?: number | null
          render_proxy_generated_at?: string | null
          render_proxy_url?: string | null
          render_status?: string | null
          rendered_url?: string | null
          segment_error?: string | null
          segment_status?: string | null
          segments_detected_at?: string | null
          size_bytes?: number | null
          source?: string | null
          speaker_role?: string | null
          staff_id?: string | null
          status?: string | null
          tag_error?: string | null
          tags?: Json | null
          thumbnail_url?: string | null
          transcode_status?: string | null
          transcript_words?: Json | null
          transcription?: string | null
          transforms?: Json | null
          updated_at?: string
          variant_label?: string | null
          video_edit_draft?: Json | null
          visual_narrative?: string | null
          web_blob_url?: string | null
          web_height?: number | null
          web_width?: number | null
          width?: number | null
          workspace_id: string
        }
        Update: {
          ai_tags?: Json | null
          alt_text?: string | null
          archived_at?: string | null
          aspect_ratio?: string | null
          asset_purpose?: string
          blob_pathname?: string | null
          blob_url?: string | null
          captured_at?: string | null
          condition?: string | null
          consent_notes?: string | null
          consent_status?: string
          consent_updated_at?: string | null
          consent_updated_by?: string | null
          content_item_ids?: Json | null
          created_at?: string
          created_by?: string | null
          display_title?: string | null
          drive_id?: string | null
          duration_s?: number | null
          filename?: string | null
          height?: number | null
          id?: string
          kind?: string
          mime_type?: string | null
          mux_asset_id?: string | null
          mux_playback_id?: string | null
          notes?: string | null
          original_blob_url?: string | null
          parent_asset_id?: string | null
          parent_id?: string | null
          patient_pseudonym?: string | null
          render_error?: string | null
          render_proxy_bytes?: number | null
          render_proxy_generated_at?: string | null
          render_proxy_url?: string | null
          render_status?: string | null
          rendered_url?: string | null
          segment_error?: string | null
          segment_status?: string | null
          segments_detected_at?: string | null
          size_bytes?: number | null
          source?: string | null
          speaker_role?: string | null
          staff_id?: string | null
          status?: string | null
          tag_error?: string | null
          tags?: Json | null
          thumbnail_url?: string | null
          transcode_status?: string | null
          transcript_words?: Json | null
          transcription?: string | null
          transforms?: Json | null
          updated_at?: string
          variant_label?: string | null
          video_edit_draft?: Json | null
          visual_narrative?: string | null
          web_blob_url?: string | null
          web_height?: number | null
          web_width?: number | null
          width?: number | null
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "media_assets_parent_asset_id_fkey"
            columns: ["parent_asset_id"]
            isOneToOne: false
            referencedRelation: "media_assets"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "media_assets_parent_id_fkey"
            columns: ["parent_id"]
            isOneToOne: false
            referencedRelation: "media_assets"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "media_assets_staff_id_fkey"
            columns: ["staff_id"]
            isOneToOne: false
            referencedRelation: "staff"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "media_assets_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      media_audit: {
        Row: {
          action: string
          actor: string | null
          after: Json | null
          asset_id: string | null
          before: Json | null
          created_at: string
          id: string
          ip: string | null
          user_agent: string | null
          workspace_id: string
        }
        Insert: {
          action: string
          actor?: string | null
          after?: Json | null
          asset_id?: string | null
          before?: Json | null
          created_at?: string
          id?: string
          ip?: string | null
          user_agent?: string | null
          workspace_id: string
        }
        Update: {
          action?: string
          actor?: string | null
          after?: Json | null
          asset_id?: string | null
          before?: Json | null
          created_at?: string
          id?: string
          ip?: string | null
          user_agent?: string | null
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "media_audit_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      moments: {
        Row: {
          anchor: Json
          clip_asset_id: string | null
          cluster_id: string | null
          created_at: string
          embedding: string | null
          excerpt: string
          hook: string | null
          id: string
          interview_id: string
          is_exemplar: boolean
          last_used_at: string | null
          moment_type: string | null
          region: string | null
          retire_note: string | null
          retire_reasons: string[] | null
          review_by: string | null
          reviewed_at: string | null
          reviewed_by: string | null
          score: number | null
          sent_back_at: string | null
          sent_back_by: string | null
          sent_back_note: string | null
          sent_back_notified_at: string | null
          staff_id: string | null
          status: string
          tags: string[] | null
          topic: string | null
          updated_at: string
          usage_count: number
          workspace_id: string
        }
        Insert: {
          anchor: Json
          clip_asset_id?: string | null
          cluster_id?: string | null
          created_at?: string
          embedding?: string | null
          excerpt: string
          hook?: string | null
          id?: string
          interview_id: string
          is_exemplar?: boolean
          last_used_at?: string | null
          moment_type?: string | null
          region?: string | null
          retire_note?: string | null
          retire_reasons?: string[] | null
          review_by?: string | null
          reviewed_at?: string | null
          reviewed_by?: string | null
          score?: number | null
          sent_back_at?: string | null
          sent_back_by?: string | null
          sent_back_note?: string | null
          sent_back_notified_at?: string | null
          staff_id?: string | null
          status?: string
          tags?: string[] | null
          topic?: string | null
          updated_at?: string
          usage_count?: number
          workspace_id: string
        }
        Update: {
          anchor?: Json
          clip_asset_id?: string | null
          cluster_id?: string | null
          created_at?: string
          embedding?: string | null
          excerpt?: string
          hook?: string | null
          id?: string
          interview_id?: string
          is_exemplar?: boolean
          last_used_at?: string | null
          moment_type?: string | null
          region?: string | null
          retire_note?: string | null
          retire_reasons?: string[] | null
          review_by?: string | null
          reviewed_at?: string | null
          reviewed_by?: string | null
          score?: number | null
          sent_back_at?: string | null
          sent_back_by?: string | null
          sent_back_note?: string | null
          sent_back_notified_at?: string | null
          staff_id?: string | null
          status?: string
          tags?: string[] | null
          topic?: string | null
          updated_at?: string
          usage_count?: number
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "moments_clip_asset_id_fkey"
            columns: ["clip_asset_id"]
            isOneToOne: false
            referencedRelation: "media_assets"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "moments_interview_id_fkey"
            columns: ["interview_id"]
            isOneToOne: false
            referencedRelation: "interviews"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "moments_staff_id_fkey"
            columns: ["staff_id"]
            isOneToOne: false
            referencedRelation: "staff"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "moments_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      music_tracks: {
        Row: {
          blob_url: string
          created_at: string
          duration_sec: number | null
          id: string
          mood: string
          title: string
          uploaded_by: string | null
          workspace_id: string | null
        }
        Insert: {
          blob_url: string
          created_at?: string
          duration_sec?: number | null
          id?: string
          mood: string
          title: string
          uploaded_by?: string | null
          workspace_id?: string | null
        }
        Update: {
          blob_url?: string
          created_at?: string
          duration_sec?: number | null
          id?: string
          mood?: string
          title?: string
          uploaded_by?: string | null
          workspace_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "music_tracks_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      practice_memory_chunks: {
        Row: {
          chunk_index: number
          created_at: string
          embedding: string | null
          id: string
          source_date: string | null
          source_id: string
          source_label: string | null
          source_type: string
          staff_id: string | null
          text: string
          tokens: number | null
          topic_tags: Json | null
          updated_at: string
          workspace_id: string
        }
        Insert: {
          chunk_index?: number
          created_at?: string
          embedding?: string | null
          id?: string
          source_date?: string | null
          source_id: string
          source_label?: string | null
          source_type: string
          staff_id?: string | null
          text: string
          tokens?: number | null
          topic_tags?: Json | null
          updated_at?: string
          workspace_id: string
        }
        Update: {
          chunk_index?: number
          created_at?: string
          embedding?: string | null
          id?: string
          source_date?: string | null
          source_id?: string
          source_label?: string | null
          source_type?: string
          staff_id?: string | null
          text?: string
          tokens?: number | null
          topic_tags?: Json | null
          updated_at?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "practice_memory_chunks_staff_id_fkey"
            columns: ["staff_id"]
            isOneToOne: false
            referencedRelation: "staff"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "practice_memory_chunks_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      practice_memory_supersessions: {
        Row: {
          confidence: number | null
          detected_at: string
          id: string
          new_chunk_id: string
          new_excerpt: string | null
          new_source_id: string | null
          new_source_label: string | null
          old_chunk_id: string
          old_excerpt: string | null
          old_source_id: string | null
          old_source_label: string | null
          rationale: string | null
          relationship: string
          resolved_at: string | null
          resolved_by: string | null
          staff_id: string | null
          status: string
          workspace_id: string
        }
        Insert: {
          confidence?: number | null
          detected_at?: string
          id?: string
          new_chunk_id: string
          new_excerpt?: string | null
          new_source_id?: string | null
          new_source_label?: string | null
          old_chunk_id: string
          old_excerpt?: string | null
          old_source_id?: string | null
          old_source_label?: string | null
          rationale?: string | null
          relationship?: string
          resolved_at?: string | null
          resolved_by?: string | null
          staff_id?: string | null
          status?: string
          workspace_id: string
        }
        Update: {
          confidence?: number | null
          detected_at?: string
          id?: string
          new_chunk_id?: string
          new_excerpt?: string | null
          new_source_id?: string | null
          new_source_label?: string | null
          old_chunk_id?: string
          old_excerpt?: string | null
          old_source_id?: string | null
          old_source_label?: string | null
          rationale?: string | null
          relationship?: string
          resolved_at?: string | null
          resolved_by?: string | null
          staff_id?: string | null
          status?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "practice_memory_supersessions_new_chunk_id_fkey"
            columns: ["new_chunk_id"]
            isOneToOne: false
            referencedRelation: "practice_memory_chunks"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "practice_memory_supersessions_old_chunk_id_fkey"
            columns: ["old_chunk_id"]
            isOneToOne: false
            referencedRelation: "practice_memory_chunks"
            referencedColumns: ["id"]
          },
        ]
      }
      product_updates: {
        Row: {
          created_at: string
          id: string
          page_hint: string | null
          roles: string[]
          source_pr: number | null
          source_sha: string | null
          summary: string
        }
        Insert: {
          created_at?: string
          id?: string
          page_hint?: string | null
          roles?: string[]
          source_pr?: number | null
          source_sha?: string | null
          summary: string
        }
        Update: {
          created_at?: string
          id?: string
          page_hint?: string | null
          roles?: string[]
          source_pr?: number | null
          source_sha?: string | null
          summary?: string
        }
        Relationships: []
      }
      seo_citation_probes: {
        Row: {
          answer_excerpt: string | null
          cited: boolean
          cited_urls: Json
          engine: string
          id: string
          probed_at: string
          question_id: string
          top_cited_domain: string | null
          workspace_id: string
        }
        Insert: {
          answer_excerpt?: string | null
          cited?: boolean
          cited_urls?: Json
          engine: string
          id?: string
          probed_at?: string
          question_id: string
          top_cited_domain?: string | null
          workspace_id: string
        }
        Update: {
          answer_excerpt?: string | null
          cited?: boolean
          cited_urls?: Json
          engine?: string
          id?: string
          probed_at?: string
          question_id?: string
          top_cited_domain?: string | null
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "seo_citation_probes_question_id_fkey"
            columns: ["question_id"]
            isOneToOne: false
            referencedRelation: "seo_tracked_questions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "seo_citation_probes_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      seo_opportunity_dismissals: {
        Row: {
          dismissed_at: string
          dismissed_by: string | null
          id: string
          query: string
          workspace_id: string
        }
        Insert: {
          dismissed_at?: string
          dismissed_by?: string | null
          id?: string
          query: string
          workspace_id: string
        }
        Update: {
          dismissed_at?: string
          dismissed_by?: string | null
          id?: string
          query?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "seo_opportunity_dismissals_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      seo_tracked_questions: {
        Row: {
          active: boolean
          created_at: string
          goal_queued_at: string | null
          id: string
          question: string
          source: string
          topic: string | null
          workspace_id: string
        }
        Insert: {
          active?: boolean
          created_at?: string
          goal_queued_at?: string | null
          id?: string
          question: string
          source?: string
          topic?: string | null
          workspace_id: string
        }
        Update: {
          active?: boolean
          created_at?: string
          goal_queued_at?: string | null
          id?: string
          question?: string
          source?: string
          topic?: string | null
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "seo_tracked_questions_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      social_channel_snapshots: {
        Row: {
          account_username: string | null
          captured_at: string
          comments: number | null
          followers: number | null
          id: string
          impressions: number | null
          impressions_unique: number | null
          likes: number | null
          platform: string
          post_count: number | null
          snapshot_at: string | null
          source: string
          views: number | null
          views_unique: number | null
          workspace_id: string
        }
        Insert: {
          account_username?: string | null
          captured_at?: string
          comments?: number | null
          followers?: number | null
          id?: string
          impressions?: number | null
          impressions_unique?: number | null
          likes?: number | null
          platform: string
          post_count?: number | null
          snapshot_at?: string | null
          source?: string
          views?: number | null
          views_unique?: number | null
          workspace_id: string
        }
        Update: {
          account_username?: string | null
          captured_at?: string
          comments?: number | null
          followers?: number | null
          id?: string
          impressions?: number | null
          impressions_unique?: number | null
          likes?: number | null
          platform?: string
          post_count?: number | null
          snapshot_at?: string | null
          source?: string
          views?: number | null
          views_unique?: number | null
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "social_channel_snapshots_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      staff: {
        Row: {
          answer_review_enabled: boolean
          archived_at: string | null
          blog_review_enabled: boolean
          blog_target_nudged_month: string | null
          campaign_settings: Json | null
          capability_overrides: Json
          capture_upload_token: string | null
          capture_upload_token_expires_at: string | null
          capture_upload_token_last_used_at: string | null
          created_at: string
          created_by_email: string | null
          created_by_id: string | null
          default_audience: string | null
          default_story_type: string | null
          default_tone: string | null
          default_voice_mode: string | null
          eleven_voice_id: string | null
          id: string
          interview_style_memory: Json
          legal_name: string | null
          name: string
          permission_tier: string
          preferred_length: string | null
          staff_type: string
          tts_settings: Json
          updated_at: string | null
          user_id: string | null
          voice_clone_consent_at: string | null
          voice_clone_opt_out: boolean
          voice_clone_opt_out_at: string | null
          voice_clone_revoked_at: string | null
          voice_clone_sample_url: string | null
          voice_notes: string | null
          voice_notes_edits_analyzed: number
          voice_notes_refreshed_at: string | null
          workspace_id: string
        }
        Insert: {
          answer_review_enabled?: boolean
          archived_at?: string | null
          blog_review_enabled?: boolean
          blog_target_nudged_month?: string | null
          campaign_settings?: Json | null
          capability_overrides?: Json
          capture_upload_token?: string | null
          capture_upload_token_expires_at?: string | null
          capture_upload_token_last_used_at?: string | null
          created_at?: string
          created_by_email?: string | null
          created_by_id?: string | null
          default_audience?: string | null
          default_story_type?: string | null
          default_tone?: string | null
          default_voice_mode?: string | null
          eleven_voice_id?: string | null
          id?: string
          interview_style_memory?: Json
          legal_name?: string | null
          name: string
          permission_tier?: string
          preferred_length?: string | null
          staff_type?: string
          tts_settings?: Json
          updated_at?: string | null
          user_id?: string | null
          voice_clone_consent_at?: string | null
          voice_clone_opt_out?: boolean
          voice_clone_opt_out_at?: string | null
          voice_clone_revoked_at?: string | null
          voice_clone_sample_url?: string | null
          voice_notes?: string | null
          voice_notes_edits_analyzed?: number
          voice_notes_refreshed_at?: string | null
          workspace_id: string
        }
        Update: {
          answer_review_enabled?: boolean
          archived_at?: string | null
          blog_review_enabled?: boolean
          blog_target_nudged_month?: string | null
          campaign_settings?: Json | null
          capability_overrides?: Json
          capture_upload_token?: string | null
          capture_upload_token_expires_at?: string | null
          capture_upload_token_last_used_at?: string | null
          created_at?: string
          created_by_email?: string | null
          created_by_id?: string | null
          default_audience?: string | null
          default_story_type?: string | null
          default_tone?: string | null
          default_voice_mode?: string | null
          eleven_voice_id?: string | null
          id?: string
          interview_style_memory?: Json
          legal_name?: string | null
          name?: string
          permission_tier?: string
          preferred_length?: string | null
          staff_type?: string
          tts_settings?: Json
          updated_at?: string | null
          user_id?: string | null
          voice_clone_consent_at?: string | null
          voice_clone_opt_out?: boolean
          voice_clone_opt_out_at?: string | null
          voice_clone_revoked_at?: string | null
          voice_clone_sample_url?: string | null
          voice_notes?: string | null
          voice_notes_edits_analyzed?: number
          voice_notes_refreshed_at?: string | null
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "staff_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      staff_corpus_documents: {
        Row: {
          archived_at: string | null
          body: string
          created_at: string
          doc_date: string | null
          doc_type: string
          id: string
          source_url: string | null
          staff_id: string | null
          title: string
          updated_at: string
          workspace_id: string
        }
        Insert: {
          archived_at?: string | null
          body: string
          created_at?: string
          doc_date?: string | null
          doc_type: string
          id?: string
          source_url?: string | null
          staff_id?: string | null
          title: string
          updated_at?: string
          workspace_id: string
        }
        Update: {
          archived_at?: string | null
          body?: string
          created_at?: string
          doc_date?: string | null
          doc_type?: string
          id?: string
          source_url?: string | null
          staff_id?: string | null
          title?: string
          updated_at?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "staff_corpus_documents_staff_id_fkey"
            columns: ["staff_id"]
            isOneToOne: false
            referencedRelation: "staff"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "staff_corpus_documents_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      staff_recipes: {
        Row: {
          audience: string | null
          cleanup_level: string | null
          created_at: string | null
          emoji: string | null
          id: string
          is_default: boolean | null
          name: string
          staff_id: string
          story_type: string | null
          tone: string | null
          updated_at: string | null
          voice_mode: string | null
          workspace_id: string
        }
        Insert: {
          audience?: string | null
          cleanup_level?: string | null
          created_at?: string | null
          emoji?: string | null
          id?: string
          is_default?: boolean | null
          name: string
          staff_id: string
          story_type?: string | null
          tone?: string | null
          updated_at?: string | null
          voice_mode?: string | null
          workspace_id: string
        }
        Update: {
          audience?: string | null
          cleanup_level?: string | null
          created_at?: string | null
          emoji?: string | null
          id?: string
          is_default?: boolean | null
          name?: string
          staff_id?: string
          story_type?: string | null
          tone?: string | null
          updated_at?: string | null
          voice_mode?: string | null
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "staff_recipes_staff_id_fkey"
            columns: ["staff_id"]
            isOneToOne: false
            referencedRelation: "staff"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "staff_recipes_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      staff_voice_phrases: {
        Row: {
          approve_count: number
          created_at: string
          first_seen_at: string
          id: string
          last_seen_at: string
          phrase: string
          phrase_normalized: string
          reject_count: number
          source: string | null
          staff_id: string
          weight: number
          workspace_id: string
        }
        Insert: {
          approve_count?: number
          created_at?: string
          first_seen_at?: string
          id?: string
          last_seen_at?: string
          phrase: string
          phrase_normalized: string
          reject_count?: number
          source?: string | null
          staff_id: string
          weight?: number
          workspace_id: string
        }
        Update: {
          approve_count?: number
          created_at?: string
          first_seen_at?: string
          id?: string
          last_seen_at?: string
          phrase?: string
          phrase_normalized?: string
          reject_count?: number
          source?: string | null
          staff_id?: string
          weight?: number
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "staff_voice_phrases_staff_id_fkey"
            columns: ["staff_id"]
            isOneToOne: false
            referencedRelation: "staff"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "staff_voice_phrases_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      story_package_chunks: {
        Row: {
          attempts: number
          blob_url: string | null
          created_at: string
          dur_sec: number
          error: string | null
          had_subtitles: boolean | null
          height: number | null
          id: string
          idx: number
          package_id: string
          size_bytes: number | null
          start_sec: number
          status: string
          updated_at: string
          width: number | null
          workspace_id: string
        }
        Insert: {
          attempts?: number
          blob_url?: string | null
          created_at?: string
          dur_sec: number
          error?: string | null
          had_subtitles?: boolean | null
          height?: number | null
          id?: string
          idx: number
          package_id: string
          size_bytes?: number | null
          start_sec: number
          status?: string
          updated_at?: string
          width?: number | null
          workspace_id: string
        }
        Update: {
          attempts?: number
          blob_url?: string | null
          created_at?: string
          dur_sec?: number
          error?: string | null
          had_subtitles?: boolean | null
          height?: number | null
          id?: string
          idx?: number
          package_id?: string
          size_bytes?: number | null
          start_sec?: number
          status?: string
          updated_at?: string
          width?: number | null
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "story_package_chunks_package_id_fkey"
            columns: ["package_id"]
            isOneToOne: false
            referencedRelation: "story_packages"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "story_package_chunks_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      story_packages: {
        Row: {
          auto_publish_state: Json | null
          auto_published_at: string | null
          broll_model: string | null
          broll_prompt: string | null
          broll_status: string | null
          broll_task_id: string | null
          campaign_id: string | null
          caption_text: string
          channels: string[]
          created_at: string
          error_message: string | null
          id: string
          rag_context: Json | null
          renders: Json
          similarity: number | null
          source_asset_id: string | null
          staff_id: string | null
          status: string
          topic: string
          updated_at: string
          voice_fidelity_breakdown: Json | null
          voice_fidelity_score: number | null
          workspace_id: string
        }
        Insert: {
          auto_publish_state?: Json | null
          auto_published_at?: string | null
          broll_model?: string | null
          broll_prompt?: string | null
          broll_status?: string | null
          broll_task_id?: string | null
          campaign_id?: string | null
          caption_text?: string
          channels?: string[]
          created_at?: string
          error_message?: string | null
          id?: string
          rag_context?: Json | null
          renders?: Json
          similarity?: number | null
          source_asset_id?: string | null
          staff_id?: string | null
          status?: string
          topic?: string
          updated_at?: string
          voice_fidelity_breakdown?: Json | null
          voice_fidelity_score?: number | null
          workspace_id: string
        }
        Update: {
          auto_publish_state?: Json | null
          auto_published_at?: string | null
          broll_model?: string | null
          broll_prompt?: string | null
          broll_status?: string | null
          broll_task_id?: string | null
          campaign_id?: string | null
          caption_text?: string
          channels?: string[]
          created_at?: string
          error_message?: string | null
          id?: string
          rag_context?: Json | null
          renders?: Json
          similarity?: number | null
          source_asset_id?: string | null
          staff_id?: string | null
          status?: string
          topic?: string
          updated_at?: string
          voice_fidelity_breakdown?: Json | null
          voice_fidelity_score?: number | null
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "story_packages_campaign_id_fkey"
            columns: ["campaign_id"]
            isOneToOne: false
            referencedRelation: "campaigns"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "story_packages_source_asset_id_fkey"
            columns: ["source_asset_id"]
            isOneToOne: false
            referencedRelation: "media_assets"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "story_packages_staff_id_fkey"
            columns: ["staff_id"]
            isOneToOne: false
            referencedRelation: "staff"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "story_packages_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      topic_backlog: {
        Row: {
          created_at: string
          id: string
          idempotency_key: string | null
          interview_id: string | null
          priority: number
          rationale: string | null
          source: string
          status: string
          topic: string
          updated_at: string
          workspace_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          idempotency_key?: string | null
          interview_id?: string | null
          priority?: number
          rationale?: string | null
          source?: string
          status?: string
          topic: string
          updated_at?: string
          workspace_id: string
        }
        Update: {
          created_at?: string
          id?: string
          idempotency_key?: string | null
          interview_id?: string | null
          priority?: number
          rationale?: string | null
          source?: string
          status?: string
          topic?: string
          updated_at?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "topic_backlog_interview_id_fkey"
            columns: ["interview_id"]
            isOneToOne: false
            referencedRelation: "interviews"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "topic_backlog_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      video_segments: {
        Row: {
          campaign_id: string | null
          created_at: string
          detection_model: string | null
          discard_note: string | null
          discard_reasons: string[] | null
          end_sec: number
          hook: string
          id: string
          moment_type: string | null
          nomination_source: string
          order_index: number
          rendered_asset_id: string | null
          score: number | null
          source_asset_id: string
          speaker_voice: string | null
          speaker_voice_confidence: number | null
          staff_id: string | null
          start_sec: number
          status: string
          story_package_id: string | null
          transcript_excerpt: string
          updated_at: string
          visual_breakdown: Json | null
          visual_score: number | null
          why_it_stands_alone: string
          workspace_id: string
        }
        Insert: {
          campaign_id?: string | null
          created_at?: string
          detection_model?: string | null
          discard_note?: string | null
          discard_reasons?: string[] | null
          end_sec: number
          hook?: string
          id?: string
          moment_type?: string | null
          nomination_source?: string
          order_index?: number
          rendered_asset_id?: string | null
          score?: number | null
          source_asset_id: string
          speaker_voice?: string | null
          speaker_voice_confidence?: number | null
          staff_id?: string | null
          start_sec: number
          status?: string
          story_package_id?: string | null
          transcript_excerpt?: string
          updated_at?: string
          visual_breakdown?: Json | null
          visual_score?: number | null
          why_it_stands_alone?: string
          workspace_id: string
        }
        Update: {
          campaign_id?: string | null
          created_at?: string
          detection_model?: string | null
          discard_note?: string | null
          discard_reasons?: string[] | null
          end_sec?: number
          hook?: string
          id?: string
          moment_type?: string | null
          nomination_source?: string
          order_index?: number
          rendered_asset_id?: string | null
          score?: number | null
          source_asset_id?: string
          speaker_voice?: string | null
          speaker_voice_confidence?: number | null
          staff_id?: string | null
          start_sec?: number
          status?: string
          story_package_id?: string | null
          transcript_excerpt?: string
          updated_at?: string
          visual_breakdown?: Json | null
          visual_score?: number | null
          why_it_stands_alone?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "video_segments_campaign_id_fkey"
            columns: ["campaign_id"]
            isOneToOne: false
            referencedRelation: "campaigns"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "video_segments_rendered_asset_id_fkey"
            columns: ["rendered_asset_id"]
            isOneToOne: false
            referencedRelation: "media_assets"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "video_segments_source_asset_id_fkey"
            columns: ["source_asset_id"]
            isOneToOne: false
            referencedRelation: "media_assets"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "video_segments_staff_id_fkey"
            columns: ["staff_id"]
            isOneToOne: false
            referencedRelation: "staff"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "video_segments_story_package_id_fkey"
            columns: ["story_package_id"]
            isOneToOne: false
            referencedRelation: "story_packages"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "video_segments_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      visual_memory_chunks: {
        Row: {
          audio_quality: number | null
          created_at: string
          embedding: string | null
          id: string
          source_blob_url: string | null
          source_id: string | null
          source_type: string
          staff_id: string | null
          story_role: string | null
          tags: Json
          video_quality: number | null
          workspace_id: string
        }
        Insert: {
          audio_quality?: number | null
          created_at?: string
          embedding?: string | null
          id?: string
          source_blob_url?: string | null
          source_id?: string | null
          source_type: string
          staff_id?: string | null
          story_role?: string | null
          tags?: Json
          video_quality?: number | null
          workspace_id: string
        }
        Update: {
          audio_quality?: number | null
          created_at?: string
          embedding?: string | null
          id?: string
          source_blob_url?: string | null
          source_id?: string | null
          source_type?: string
          staff_id?: string | null
          story_role?: string | null
          tags?: Json
          video_quality?: number | null
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "visual_memory_chunks_staff_id_fkey"
            columns: ["staff_id"]
            isOneToOne: false
            referencedRelation: "staff"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "visual_memory_chunks_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      workspace_books: {
        Row: {
          chapters: Json
          created_at: string
          last_regen_at: string | null
          manuscript_md: string | null
          regen_error: string | null
          regen_run_id: string | null
          regen_status: string
          source_counts: Json
          stale_at: string | null
          updated_at: string
          workspace_id: string
        }
        Insert: {
          chapters?: Json
          created_at?: string
          last_regen_at?: string | null
          manuscript_md?: string | null
          regen_error?: string | null
          regen_run_id?: string | null
          regen_status?: string
          source_counts?: Json
          stale_at?: string | null
          updated_at?: string
          workspace_id: string
        }
        Update: {
          chapters?: Json
          created_at?: string
          last_regen_at?: string | null
          manuscript_md?: string | null
          regen_error?: string | null
          regen_run_id?: string | null
          regen_status?: string
          source_counts?: Json
          stale_at?: string | null
          updated_at?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "workspace_books_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: true
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      workspace_coaching_notes: {
        Row: {
          created_at: string
          id: string
          note: string
          week_monday: string
          workspace_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          note: string
          week_monday: string
          workspace_id: string
        }
        Update: {
          created_at?: string
          id?: string
          note?: string
          week_monday?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "workspace_coaching_notes_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      workspace_concepts: {
        Row: {
          aliases: string[]
          evidence_count: number
          first_seen_at: string
          id: string
          kind: string
          label: string
          last_reinforced_at: string
          last_seen_at: string
          weight: number
          workspace_id: string
        }
        Insert: {
          aliases?: string[]
          evidence_count?: number
          first_seen_at?: string
          id?: string
          kind: string
          label: string
          last_reinforced_at?: string
          last_seen_at?: string
          weight?: number
          workspace_id: string
        }
        Update: {
          aliases?: string[]
          evidence_count?: number
          first_seen_at?: string
          id?: string
          kind?: string
          label?: string
          last_reinforced_at?: string
          last_seen_at?: string
          weight?: number
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "workspace_concepts_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      workspace_credentials: {
        Row: {
          config: Json | null
          created_at: string
          id: string
          secret_ciphertext: string | null
          service: string
          status: string
          updated_at: string
          workspace_id: string
        }
        Insert: {
          config?: Json | null
          created_at?: string
          id?: string
          secret_ciphertext?: string | null
          service: string
          status?: string
          updated_at?: string
          workspace_id: string
        }
        Update: {
          config?: Json | null
          created_at?: string
          id?: string
          secret_ciphertext?: string | null
          service?: string
          status?: string
          updated_at?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "workspace_credentials_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      workspace_locations: {
        Row: {
          bundle_team_id: string | null
          city: string
          created_at: string
          id: string
          is_primary: boolean
          label: string
          location_hashtag: string | null
          location_keyword: string | null
          position: number
          region: string | null
          status: string
          updated_at: string
          visit_url: string | null
          workspace_id: string
        }
        Insert: {
          bundle_team_id?: string | null
          city: string
          created_at?: string
          id?: string
          is_primary?: boolean
          label: string
          location_hashtag?: string | null
          location_keyword?: string | null
          position?: number
          region?: string | null
          status?: string
          updated_at?: string
          visit_url?: string | null
          workspace_id: string
        }
        Update: {
          bundle_team_id?: string | null
          city?: string
          created_at?: string
          id?: string
          is_primary?: boolean
          label?: string
          location_hashtag?: string | null
          location_keyword?: string | null
          position?: number
          region?: string | null
          status?: string
          updated_at?: string
          visit_url?: string | null
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "workspace_locations_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      workspace_onboarding_interviews: {
        Row: {
          completed_at: string | null
          created_at: string
          id: string
          messages: Json
          owner_id: string
          session_state: Json | null
          staff_id: string | null
          status: string
          synthesis_result: Json | null
          synthesized_at: string | null
          updated_at: string
          workspace_id: string
        }
        Insert: {
          completed_at?: string | null
          created_at?: string
          id?: string
          messages?: Json
          owner_id: string
          session_state?: Json | null
          staff_id?: string | null
          status?: string
          synthesis_result?: Json | null
          synthesized_at?: string | null
          updated_at?: string
          workspace_id: string
        }
        Update: {
          completed_at?: string | null
          created_at?: string
          id?: string
          messages?: Json
          owner_id?: string
          session_state?: Json | null
          staff_id?: string | null
          status?: string
          synthesis_result?: Json | null
          synthesized_at?: string | null
          updated_at?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "workspace_onboarding_interviews_staff_id_fkey"
            columns: ["staff_id"]
            isOneToOne: false
            referencedRelation: "staff"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "workspace_onboarding_interviews_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      workspace_photo_templates: {
        Row: {
          config: Json
          created_at: string
          id: string
          is_default: boolean
          name: string
          updated_at: string
          workspace_id: string
        }
        Insert: {
          config?: Json
          created_at?: string
          id?: string
          is_default?: boolean
          name: string
          updated_at?: string
          workspace_id: string
        }
        Update: {
          config?: Json
          created_at?: string
          id?: string
          is_default?: boolean
          name?: string
          updated_at?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "workspace_carousel_themes_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      workspace_video_templates: {
        Row: {
          config: Json
          created_at: string
          id: string
          is_default: boolean
          name: string
          updated_at: string
          workspace_id: string
        }
        Insert: {
          config?: Json
          created_at?: string
          id?: string
          is_default?: boolean
          name: string
          updated_at?: string
          workspace_id: string
        }
        Update: {
          config?: Json
          created_at?: string
          id?: string
          is_default?: boolean
          name?: string
          updated_at?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "workspace_video_templates_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      workspaces: {
        Row: {
          activity_context: string | null
          ai_topics_cache: Json | null
          ai_topics_generated_at: string | null
          answer_publish_enabled: boolean
          app_name: string | null
          audience_description: string | null
          audience_options: Json
          audience_short: string | null
          auto_publish_settings: Json
          book_mode: string
          booking_url: string | null
          brand_brief: Json | null
          brand_guidelines: string | null
          brand_hashtag: string | null
          brand_style: Json
          brand_visual_identity: Json | null
          brand_voice: string | null
          brandbook: Json | null
          buffer_use_queue: boolean
          bundle_team_id: string | null
          cadence_policy: Json | null
          capabilities: Json | null
          clerk_org_id: string | null
          clinic_context: string | null
          colors: Json | null
          created_at: string
          created_by_clerk_user_id: string | null
          display_name: string
          enabled_outputs: string[] | null
          engagement_digest_enabled: boolean
          engagement_digest_last_sent_at: string | null
          engagement_digest_recipients: string[]
          ga4_property_id: string | null
          gbp_location_name: string | null
          gsc_site_url: string | null
          id: string
          internal_links_markdown: string | null
          interview_context: Json | null
          is_founding: boolean
          last_checkin_at: string | null
          legal_name: string | null
          link_preview_blurb: string | null
          linkedin_industry: string | null
          location: string | null
          location_hashtag: string | null
          location_keyword: string | null
          logo: Json | null
          moment_bank_planning_enabled: boolean
          onboarding_completed_at: string | null
          onboarding_interview_completed_at: string | null
          onboarding_steps_done: Json | null
          patient_context: Json | null
          patient_handouts_enabled: boolean
          plan: string
          plan_seats: number
          producer_config: Json
          prompt_mode: string | null
          publish_intent: Json
          publish_provider: string
          publish_topics: Json
          rag_fusion_enabled: boolean
          rag_hot_tier_enabled: boolean
          realtime_voice_daily_cap_min: number | null
          realtime_voice_enabled: boolean
          reel_preset: string | null
          region: string | null
          region_short: string | null
          role_templates: Json | null
          schedule_prefs: Json | null
          sign_in_blurb: string | null
          signature_system_name: string | null
          signature_system_url: string | null
          skip_review: boolean
          slug: string
          social: Json | null
          social_avatar_initials: string | null
          social_length_lean: string
          spoken_url: string | null
          status: string
          story_type_options: Json
          stripe_customer_id: string | null
          stripe_price_id: string | null
          stripe_subscription_id: string | null
          tagline: string | null
          tone_modifiers: Json | null
          topic_suggestions: Json | null
          transcript_glossary: Json | null
          trial_ends_at: string | null
          trial_started_at: string | null
          updated_at: string
          video_pipeline_enabled: boolean
          video_playback_policy: string | null
          website: string | null
          website_hostname: string | null
        }
        Insert: {
          activity_context?: string | null
          ai_topics_cache?: Json | null
          ai_topics_generated_at?: string | null
          answer_publish_enabled?: boolean
          app_name?: string | null
          audience_description?: string | null
          audience_options?: Json
          audience_short?: string | null
          auto_publish_settings?: Json
          book_mode?: string
          booking_url?: string | null
          brand_brief?: Json | null
          brand_guidelines?: string | null
          brand_hashtag?: string | null
          brand_style?: Json
          brand_visual_identity?: Json | null
          brand_voice?: string | null
          brandbook?: Json | null
          buffer_use_queue?: boolean
          bundle_team_id?: string | null
          cadence_policy?: Json | null
          capabilities?: Json | null
          clerk_org_id?: string | null
          clinic_context?: string | null
          colors?: Json | null
          created_at?: string
          created_by_clerk_user_id?: string | null
          display_name: string
          enabled_outputs?: string[] | null
          engagement_digest_enabled?: boolean
          engagement_digest_last_sent_at?: string | null
          engagement_digest_recipients?: string[]
          ga4_property_id?: string | null
          gbp_location_name?: string | null
          gsc_site_url?: string | null
          id?: string
          internal_links_markdown?: string | null
          interview_context?: Json | null
          is_founding?: boolean
          last_checkin_at?: string | null
          legal_name?: string | null
          link_preview_blurb?: string | null
          linkedin_industry?: string | null
          location?: string | null
          location_hashtag?: string | null
          location_keyword?: string | null
          logo?: Json | null
          moment_bank_planning_enabled?: boolean
          onboarding_completed_at?: string | null
          onboarding_interview_completed_at?: string | null
          onboarding_steps_done?: Json | null
          patient_context?: Json | null
          patient_handouts_enabled?: boolean
          plan?: string
          plan_seats?: number
          producer_config?: Json
          prompt_mode?: string | null
          publish_intent?: Json
          publish_provider?: string
          publish_topics?: Json
          rag_fusion_enabled?: boolean
          rag_hot_tier_enabled?: boolean
          realtime_voice_daily_cap_min?: number | null
          realtime_voice_enabled?: boolean
          reel_preset?: string | null
          region?: string | null
          region_short?: string | null
          role_templates?: Json | null
          schedule_prefs?: Json | null
          sign_in_blurb?: string | null
          signature_system_name?: string | null
          signature_system_url?: string | null
          skip_review?: boolean
          slug: string
          social?: Json | null
          social_avatar_initials?: string | null
          social_length_lean?: string
          spoken_url?: string | null
          status?: string
          story_type_options?: Json
          stripe_customer_id?: string | null
          stripe_price_id?: string | null
          stripe_subscription_id?: string | null
          tagline?: string | null
          tone_modifiers?: Json | null
          topic_suggestions?: Json | null
          transcript_glossary?: Json | null
          trial_ends_at?: string | null
          trial_started_at?: string | null
          updated_at?: string
          video_pipeline_enabled?: boolean
          video_playback_policy?: string | null
          website?: string | null
          website_hostname?: string | null
        }
        Update: {
          activity_context?: string | null
          ai_topics_cache?: Json | null
          ai_topics_generated_at?: string | null
          answer_publish_enabled?: boolean
          app_name?: string | null
          audience_description?: string | null
          audience_options?: Json
          audience_short?: string | null
          auto_publish_settings?: Json
          book_mode?: string
          booking_url?: string | null
          brand_brief?: Json | null
          brand_guidelines?: string | null
          brand_hashtag?: string | null
          brand_style?: Json
          brand_visual_identity?: Json | null
          brand_voice?: string | null
          brandbook?: Json | null
          buffer_use_queue?: boolean
          bundle_team_id?: string | null
          cadence_policy?: Json | null
          capabilities?: Json | null
          clerk_org_id?: string | null
          clinic_context?: string | null
          colors?: Json | null
          created_at?: string
          created_by_clerk_user_id?: string | null
          display_name?: string
          enabled_outputs?: string[] | null
          engagement_digest_enabled?: boolean
          engagement_digest_last_sent_at?: string | null
          engagement_digest_recipients?: string[]
          ga4_property_id?: string | null
          gbp_location_name?: string | null
          gsc_site_url?: string | null
          id?: string
          internal_links_markdown?: string | null
          interview_context?: Json | null
          is_founding?: boolean
          last_checkin_at?: string | null
          legal_name?: string | null
          link_preview_blurb?: string | null
          linkedin_industry?: string | null
          location?: string | null
          location_hashtag?: string | null
          location_keyword?: string | null
          logo?: Json | null
          moment_bank_planning_enabled?: boolean
          onboarding_completed_at?: string | null
          onboarding_interview_completed_at?: string | null
          onboarding_steps_done?: Json | null
          patient_context?: Json | null
          patient_handouts_enabled?: boolean
          plan?: string
          plan_seats?: number
          producer_config?: Json
          prompt_mode?: string | null
          publish_intent?: Json
          publish_provider?: string
          publish_topics?: Json
          rag_fusion_enabled?: boolean
          rag_hot_tier_enabled?: boolean
          realtime_voice_daily_cap_min?: number | null
          realtime_voice_enabled?: boolean
          reel_preset?: string | null
          region?: string | null
          region_short?: string | null
          role_templates?: Json | null
          schedule_prefs?: Json | null
          sign_in_blurb?: string | null
          signature_system_name?: string | null
          signature_system_url?: string | null
          skip_review?: boolean
          slug?: string
          social?: Json | null
          social_avatar_initials?: string | null
          social_length_lean?: string
          spoken_url?: string | null
          status?: string
          story_type_options?: Json
          stripe_customer_id?: string | null
          stripe_price_id?: string | null
          stripe_subscription_id?: string | null
          tagline?: string | null
          tone_modifiers?: Json | null
          topic_suggestions?: Json | null
          transcript_glossary?: Json | null
          trial_ends_at?: string | null
          trial_started_at?: string | null
          updated_at?: string
          video_pipeline_enabled?: boolean
          video_playback_policy?: string | null
          website?: string | null
          website_hostname?: string | null
        }
        Relationships: []
      }
    }
    Views: {
      media_asset_usage: {
        Row: {
          asset_id: string | null
          last_used_at: string | null
          published_count: number | null
          published_platforms: Json | null
          use_count: number | null
          workspace_id: string | null
        }
        Relationships: [
          {
            foreignKeyName: "content_items_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Functions: {
      match_moments: {
        Args: {
          p_match_count?: number
          p_min_sim?: number
          p_query_embedding: string
          p_workspace: string
        }
        Returns: {
          cluster_id: string
          excerpt: string
          id: string
          interview_id: string
          is_exemplar: boolean
          score: number
          similarity: number
        }[]
      }
      match_practice_memory_chunks: {
        Args: {
          p_exclude_source_ids?: string[]
          p_half_life_days?: number
          p_match_count?: number
          p_query_embedding: string
          p_source_types?: string[]
          p_staff_id: string
          p_workspace_id: string
        }
        Returns: {
          id: string
          similarity: number
          source_id: string
          source_label: string
          source_type: string
          text: string
        }[]
      }
      match_visual_memory_chunks: {
        Args: {
          filter_kind?: string
          filter_min_score?: number
          filter_staff_id?: string
          filter_workspace_id?: string
          match_count?: number
          query_embedding: string
        }
        Returns: {
          asset_ai_tags: Json
          asset_aspect_ratio: string
          asset_blob_url: string
          asset_captured_at: string
          asset_display_title: string
          asset_duration_s: number
          asset_filename: string
          asset_kind: string
          asset_thumbnail_url: string
          asset_visual_narrative: string
          audio_quality: number
          chunk_id: string
          chunk_tags: Json
          similarity: number
          source_blob_url: string
          source_id: string
          source_type: string
          staff_id: string
          story_role: string
          video_quality: number
          workspace_id: string
        }[]
      }
      merge_staff: {
        Args: { p_source: string; p_target: string; p_workspace: string }
        Returns: undefined
      }
      platform_usage: { Args: never; Returns: Json }
      show_limit: { Args: never; Returns: number }
      show_trgm: { Args: { "": string }; Returns: string[] }
      workspace_recap: { Args: { ws_id: string }; Returns: Json }
      workspace_usage:
        | { Args: { n_weeks?: number; ws_id: string }; Returns: Json }
        | {
            Args: { n_weeks?: number; week_offset?: number; ws_id: string }
            Returns: Json
          }
      workspace_week_recap: {
        Args: { wk_offset?: number; ws_id: string }
        Returns: Json
      }
    }
    Enums: {
      [_ in never]: never
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R
      }
      ? R
      : never
    : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I
      }
      ? I
      : never
    : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U
      }
      ? U
      : never
    : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends (DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never) = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends (PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never) = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  public: {
    Enums: {},
  },
} as const
