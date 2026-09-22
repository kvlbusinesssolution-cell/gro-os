-- AddForeignKey
ALTER TABLE "ConversationIntelligence" ADD CONSTRAINT "ConversationIntelligence_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ConversationIntelligence" ADD CONSTRAINT "ConversationIntelligence_contactId_fkey" FOREIGN KEY ("contactId") REFERENCES "Contact"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ConversationIntelligence" ADD CONSTRAINT "ConversationIntelligence_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE SET NULL ON UPDATE CASCADE;
