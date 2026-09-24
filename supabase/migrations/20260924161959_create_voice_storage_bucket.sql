/*
# Create storage bucket for voice cloner reference audio

1. Storage
- Create a public storage bucket named "voice-cloner" for storing user-uploaded reference audio clips.
- The bucket is public so Replicate can fetch the audio URL directly.
2. Security
- No RLS policies needed on the bucket itself (public read for Replicate fetch).
- INSERT/SELECT allowed for anon + authenticated since this is a no-auth app.
*/

INSERT INTO storage.buckets (id, name, public)
VALUES ('voice-cloner', 'voice-cloner', true)
ON CONFLICT (id) DO NOTHING;

DROP POLICY IF EXISTS "anon_upload_voice" ON storage.objects;
CREATE POLICY "anon_upload_voice"
ON storage.objects FOR INSERT
TO anon, authenticated
WITH CHECK (bucket_id = 'voice-cloner');

DROP POLICY IF EXISTS "anon_read_voice" ON storage.objects;
CREATE POLICY "anon_read_voice"
ON storage.objects FOR SELECT
TO anon, authenticated
USING (bucket_id = 'voice-cloner');

DROP POLICY IF EXISTS "anon_delete_voice" ON storage.objects;
CREATE POLICY "anon_delete_voice"
ON storage.objects FOR DELETE
TO anon, authenticated
USING (bucket_id = 'voice-cloner');
